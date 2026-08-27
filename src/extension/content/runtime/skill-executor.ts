import type {
  ActionTraceStep,
  JsonObject,
  SkillExecutionResult,
  SkillStep,
  WebSkill,
} from "../../../shared/types";
import {
  interpolate,
  interpolateLocator,
  resolveSemanticLocator,
} from "../page/semantic-dom";

export interface SkillExecutorOptions {
  document?: Document;
  onStep?: (trace: ActionTraceStep, index: number) => void;
  signal?: AbortSignal;
}

function dispatchInput(element: HTMLElement, value: string): void {
  if (element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
  } else if (element instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(element, value);
  } else if (element.isContentEditable) {
    element.textContent = value;
  } else {
    throw new Error("Target is not a text input");
  }
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function dispatchSelect(element: Element, value: string): void {
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error("Target is not a select element");
  }
  element.value = value;
  if (element.value !== value) {
    throw new Error(`Select option \"${value}\" was not found`);
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function waitForTarget(
  step: SkillStep,
  input: JsonObject,
  doc: Document,
): Promise<Element | null> {
  if (!step.target) {
    const waitMs = Number(interpolate(step.value ?? "0", input));
    await new Promise((resolve) => window.setTimeout(resolve, Number.isFinite(waitMs) ? waitMs : 0));
    return null;
  }

  const locator = interpolateLocator(step.target, input);
  const timeoutMs = step.timeoutMs ?? 5_000;
  const startedAt = performance.now();
  while (performance.now() - startedAt <= timeoutMs) {
    const element = resolveSemanticLocator(locator, doc);
    if (element) return element;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for target after ${timeoutMs}ms`);
}

async function executeStep(
  step: SkillStep,
  input: JsonObject,
  doc: Document,
): Promise<void> {
  if (step.action === "wait") {
    await waitForTarget(step, input, doc);
    return;
  }

  if (step.action === "navigate") {
    const destination = interpolate(step.value ?? "", input);
    if (!destination) throw new Error("Navigate step is missing a destination");
    doc.location.assign(destination);
    return;
  }

  if (!step.target) throw new Error(`${step.action} step is missing a target`);
  const locator = interpolateLocator(step.target, input);
  const element = resolveSemanticLocator(locator, doc);
  if (!element) {
    throw new Error(`Semantic target not found: ${JSON.stringify(locator)}`);
  }

  if (step.action === "click") {
    if (!(element instanceof HTMLElement)) throw new Error("Target cannot be clicked");
    element.click();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return;
  }

  const value = interpolate(step.value ?? "", input);
  if (step.action === "type") {
    if (!(element instanceof HTMLElement)) throw new Error("Target cannot receive text");
    dispatchInput(element, value);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return;
  }

  dispatchSelect(element, value);
  await new Promise((resolve) => window.setTimeout(resolve, 0));
}

export async function executeSkill(
  skill: WebSkill,
  input: JsonObject,
  options: SkillExecutorOptions = {},
): Promise<SkillExecutionResult> {
  const doc = options.document ?? document;
  const trace: ActionTraceStep[] = [];
  const startedAt = performance.now();

  for (const [index, step] of skill.workflow.entries()) {
    if (options.signal?.aborted) {
      return {
        success: false,
        trace,
        failedStepIndex: index,
        error: "Skill execution was aborted",
        durationMs: performance.now() - startedAt,
      };
    }

    const stepStartedAt = performance.now();
    try {
      await executeStep(step, input, doc);
      const item: ActionTraceStep = {
        ...step,
        timestamp: Date.now(),
        durationMs: performance.now() - stepStartedAt,
        outcome: "success",
      };
      trace.push(item);
      options.onStep?.(item, index);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const item: ActionTraceStep = {
        ...step,
        timestamp: Date.now(),
        durationMs: performance.now() - stepStartedAt,
        outcome: "failure",
        error: message,
      };
      trace.push(item);
      options.onStep?.(item, index);
      return {
        success: false,
        trace,
        failedStepIndex: index,
        error: message,
        durationMs: performance.now() - startedAt,
      };
    }
  }

  return {
    success: true,
    trace,
    durationMs: performance.now() - startedAt,
  };
}
