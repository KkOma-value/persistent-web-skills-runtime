import { stableStringify } from "../../../shared/hash";
import type {
  AgentToolDecision,
  BrowserLearningAgent,
  JsonObject,
  NativeToolSnapshot,
  RuntimeEvent,
  RuntimeTaskResult,
  WebSkill,
} from "../../../shared/types";
import type { SkillStore } from "../../../storage/skill-registry";
import { capturePageFingerprint, validatePageFingerprint } from "../page/fingerprint";
import { captureSemanticDom } from "../page/semantic-dom";
import { WebMCPDiscovery, type DiscoveryResult } from "../webmcp/discovery";
import { executeSkill } from "./skill-executor";
import { RepairEngine } from "./repair-engine";
import { ToolCatalog } from "./tool-catalog";
import { validateResult } from "./validator";

export interface NativeToolRuntime {
  discover(): Promise<DiscoveryResult>;
  execute(toolName: string, input: JsonObject): Promise<unknown>;
  subscribe?(listener: (result: DiscoveryResult) => void): () => void;
}

export class DirectNativeToolRuntime implements NativeToolRuntime {
  private readonly discovery: WebMCPDiscovery;

  constructor(doc: Document = document) {
    this.discovery = new WebMCPDiscovery(doc);
  }

  discover(): Promise<DiscoveryResult> {
    return this.discovery.discover();
  }

  execute(toolName: string, input: JsonObject): Promise<unknown> {
    return this.discovery.execute(toolName, input);
  }

  subscribe(listener: (result: DiscoveryResult) => void): () => void {
    return this.discovery.subscribe(listener);
  }
}

export interface RuntimeOrchestratorOptions {
  registry: SkillStore;
  learningAgent: BrowserLearningAgent;
  nativeRuntime?: NativeToolRuntime;
  catalog?: ToolCatalog;
  repairEngine?: RepairEngine;
  document?: Document;
  decideTool?: (
    request: string,
    tools: ReturnType<ToolCatalog["getTools"]>,
    input: JsonObject,
  ) => Promise<AgentToolDecision>;
  onEvent?: (event: RuntimeEvent) => void;
  onNativeSync?: (tools: NativeToolSnapshot[]) => void;
  onSkillsChanged?: (skills: WebSkill[]) => void;
}

export interface ExecuteTaskOptions {
  toolName?: string;
}

export class RuntimeOrchestrator {
  readonly catalog: ToolCatalog;

  private readonly registry: SkillStore;
  private readonly learningAgent: BrowserLearningAgent;
  private readonly nativeRuntime: NativeToolRuntime;
  private readonly repairEngine: RepairEngine;
  private readonly doc: Document;
  private readonly decideTool?: RuntimeOrchestratorOptions["decideTool"];
  private readonly onEvent?: (event: RuntimeEvent) => void;
  private readonly onNativeSync?: (tools: NativeToolSnapshot[]) => void;
  private readonly onSkillsChanged?: (skills: WebSkill[]) => void;
  private readonly eventHistory: RuntimeEvent[] = [];
  private stopNativeSubscription?: () => void;

  constructor(options: RuntimeOrchestratorOptions) {
    this.registry = options.registry;
    this.learningAgent = options.learningAgent;
    this.doc = options.document ?? document;
    this.nativeRuntime = options.nativeRuntime ?? new DirectNativeToolRuntime(this.doc);
    this.catalog = options.catalog ?? new ToolCatalog();
    this.repairEngine = options.repairEngine ?? new RepairEngine({ endpoint: "/api/repair-skill" });
    this.decideTool = options.decideTool;
    this.onEvent = options.onEvent;
    this.onNativeSync = options.onNativeSync;
    this.onSkillsChanged = options.onSkillsChanged;
  }

  async initialize(): Promise<void> {
    await Promise.all([this.refreshNative("initial"), this.refreshSkills()]);
    this.stopNativeSubscription = this.nativeRuntime.subscribe?.((result) => {
      this.applyNativeDiscovery(result, "toolchange");
    });
  }

  destroy(): void {
    this.stopNativeSubscription?.();
  }

  getEvents(): RuntimeEvent[] {
    return [...this.eventHistory];
  }

  async refreshSkills(): Promise<WebSkill[]> {
    const skills = await this.registry.list();
    this.catalog.syncSkills(skills);
    this.onSkillsChanged?.(skills);
    return skills;
  }

  async refreshNative(reason: "initial" | "task" | "refresh" = "refresh"): Promise<void> {
    const discovery = await this.nativeRuntime.discover();
    this.applyNativeDiscovery(discovery, reason);
  }

  async executeTask(
    request: string,
    input: JsonObject = {},
    options: ExecuteTaskOptions = {},
  ): Promise<RuntimeTaskResult> {
    const startedAt = performance.now();
    const firstEventIndex = this.eventHistory.length;
    try {
      this.emit("discover", "Inspecting current website", "Checking native WebMCP tools first.", "info");
      await this.refreshNative("task");
      const skills = await this.refreshSkills();

      const decision = options.toolName
        ? { toolName: options.toolName, input, confidence: 1 }
        : await this.makeDecision(request, input);
      const resolvedTool = decision.toolName
        ? this.catalog.resolve(decision.toolName)
        : undefined;

      if (resolvedTool?.source === "native-webmcp") {
        this.emit(
          "native",
          `Native WebMCP · ${resolvedTool.name}()` ,
          "Rebinding the current RegisteredTool before execution.",
          "pending",
        );
        const output = await this.nativeRuntime.execute(resolvedTool.name, decision.input);
        this.emit("complete", "Native tool completed", resolvedTool.name, "success");
        return this.result(
          "native-webmcp",
          performance.now() - startedAt,
          firstEventIndex,
          { output },
        );
      }

      const desiredSkillName =
        resolvedTool?.source === "learned-skill"
          ? resolvedTool.name
          : decision.toolName;
      const cachedSkill = await this.registry.findMatching(
        this.doc.location.href,
        desiredSkillName,
      );

      if (cachedSkill) {
        this.emit(
          "memory",
          `Memory hit · ${cachedSkill.name}()` ,
          `Skill v${cachedSkill.version} matched this URL.`,
          "success",
        );
        return await this.executeCachedSkill(
          cachedSkill,
          decision.input,
          startedAt,
          firstEventIndex,
        );
      }

      this.emit(
        "learn",
        "No reusable skill found",
        `${skills.length} cached skill${skills.length === 1 ? "" : "s"} checked. Browser agent entering Learn Mode.`,
        "warning",
      );
      const learned = await this.learningAgent.learn(request, decision.input);
      if (!learned.validation.valid) {
        throw new Error(`Learned workflow failed validation: ${learned.validation.reason}`);
      }
      await this.registry.save(learned.skill);
      await this.refreshSkills();
      this.emit(
        "learn",
        `Saved ${learned.skill.name}() v${learned.skill.version}`,
        `Abstracted ${learned.trace.length} successful browser actions into a reusable skill.`,
        "success",
      );
      this.emit("complete", "Learned task completed", learned.validation.reason, "success");
      return this.result(
        "learned-skill",
        performance.now() - startedAt,
        firstEventIndex,
        { output: learned.output, skill: learned.skill },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("error", "Task failed", message, "error");
      throw error;
    }
  }

  private async executeCachedSkill(
    skill: WebSkill,
    input: JsonObject,
    startedAt: number,
    firstEventIndex: number,
  ): Promise<RuntimeTaskResult> {
    const fingerprint = validatePageFingerprint(skill, this.doc);
    this.emit(
      "validate",
      fingerprint.valid ? "Fingerprint compatible" : "Relevant page structure changed",
      fingerprint.reason,
      fingerprint.valid ? "success" : "warning",
      { score: fingerprint.score },
    );

    if (!fingerprint.valid) {
      const failedStepIndex = this.findDriftedStep(skill, fingerprint.missingDependencyIds);
      return this.repairAndRetry(
        skill,
        input,
        failedStepIndex,
        fingerprint.reason,
        startedAt,
        firstEventIndex,
      );
    }

    this.emit("execute", `Executing ${skill.workflow.length} cached actions`, undefined, "pending");
    const execution = await executeSkill(skill, input, { document: this.doc });
    if (!execution.success) {
      await this.registry.recordOutcome(skill.id, false);
      return this.repairAndRetry(
        skill,
        input,
        execution.failedStepIndex ?? Math.max(0, skill.workflow.length - 1),
        execution.error ?? "Skill execution failed",
        startedAt,
        firstEventIndex,
      );
    }

    const validation = await validateResult(skill.validation, input, this.doc);
    this.emit(
      "validate",
      validation.valid ? "Outcome validated" : "Outcome validation failed",
      validation.reason,
      validation.valid ? "success" : "error",
    );
    if (!validation.valid) {
      await this.registry.recordOutcome(skill.id, false);
      return this.repairAndRetry(
        skill,
        input,
        Math.max(0, skill.workflow.length - 1),
        validation.reason,
        startedAt,
        firstEventIndex,
      );
    }

    const updatedSkill = await this.registry.recordOutcome(skill.id, true);
    await this.refreshSkills();
    this.emit(
      "complete",
      "Cached skill completed",
      `${execution.trace.length} actions · validation passed`,
      "success",
    );
    return this.result(
      "cached-skill",
      performance.now() - startedAt,
      firstEventIndex,
      { skill: updatedSkill ?? skill },
    );
  }

  private async repairAndRetry(
    skill: WebSkill,
    input: JsonObject,
    failedStepIndex: number,
    failureReason: string,
    startedAt: number,
    firstEventIndex: number,
  ): Promise<RuntimeTaskResult> {
    this.emit(
      "repair",
      `Repairing ${skill.name}() v${skill.version}`,
      `Only failed step ${failedStepIndex + 1} will be reconsidered.`,
      "pending",
    );
    const repair = await this.repairEngine.repair({
      oldSkill: skill,
      failedStepIndex,
      failureReason,
      oldFingerprint: skill.fingerprint,
      currentSemanticDom: captureSemanticDom(this.doc),
    });
    const patchedSkill: WebSkill = {
      ...repair.patchedSkill,
      fingerprint: capturePageFingerprint(
        repair.patchedSkill.dependencies,
        repair.patchedSkill.urlPattern,
        this.doc,
      ),
    };
    this.emit(
      "repair",
      `Patched failed step ${failedStepIndex + 1}`,
      repair.reason,
      "info",
      { strategy: repair.strategy, changes: repair.changes },
    );
    const execution = await executeSkill(patchedSkill, input, { document: this.doc });
    if (!execution.success) {
      throw new Error(`Patched skill failed: ${execution.error}`);
    }
    const validation = await validateResult(patchedSkill.validation, input, this.doc);
    if (!validation.valid) {
      throw new Error(`Patched skill failed validation: ${validation.reason}`);
    }

    await this.registry.save(patchedSkill);
    const updatedSkill = await this.registry.recordOutcome(patchedSkill.id, true);
    await this.refreshSkills();
    const change = repair.changes[0];
    this.emit(
      "repair",
      `Recovered · v${skill.version} → v${patchedSkill.version}`,
      change
        ? `${JSON.stringify(change.before)} → ${JSON.stringify(change.after)}`
        : repair.reason,
      "success",
      { strategy: repair.strategy, changes: repair.changes },
    );
    this.emit("complete", "Repaired skill completed", validation.reason, "success");
    return this.result(
      "repaired-skill",
      performance.now() - startedAt,
      firstEventIndex,
      { skill: updatedSkill ?? patchedSkill },
    );
  }

  private findDriftedStep(skill: WebSkill, missingDependencyIds: string[]): number {
    const missingLocators = new Set(
      skill.dependencies
        .filter((dependency) => missingDependencyIds.includes(dependency.id))
        .map((dependency) => stableStringify(dependency.locator)),
    );
    const index = skill.workflow.findIndex(
      (step) => step.target && missingLocators.has(stableStringify(step.target)),
    );
    return index >= 0 ? index : Math.max(0, skill.workflow.length - 1);
  }

  private async makeDecision(
    request: string,
    input: JsonObject,
  ): Promise<AgentToolDecision> {
    if (this.decideTool) {
      return this.decideTool(request, this.catalog.getTools(), input);
    }
    return this.catalog.decide(request, input);
  }

  private applyNativeDiscovery(
    result: DiscoveryResult,
    reason: "initial" | "task" | "refresh" | "toolchange",
  ): void {
    const diff = this.catalog.syncNative(result.tools);
    this.onNativeSync?.(result.tools);
    if (reason === "toolchange") {
      const detail = [
        ...diff.added.map((tool) => `+ ${tool.name}()`),
        ...diff.removed.map((tool) => `− ${tool.name}()`),
        ...diff.changed.map((tool) => `~ ${tool.name}()`),
      ].join(" · ");
      this.emit(
        "discover",
        "WebMCP toolchange synchronized",
        detail || "Catalog already current.",
        "success",
      );
    }
    if (result.error) {
      this.emit("discover", "WebMCP discovery degraded", result.error, "warning");
    }
  }

  private emit(
    phase: RuntimeEvent["phase"],
    title: string,
    detail: string | undefined,
    status: RuntimeEvent["status"],
    metadata?: JsonObject,
  ): RuntimeEvent {
    const event: RuntimeEvent = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      phase,
      title,
      detail,
      status,
      metadata,
    };
    this.eventHistory.push(event);
    if (this.eventHistory.length > 100) this.eventHistory.splice(0, 20);
    this.onEvent?.(event);
    return event;
  }

  private result(
    route: RuntimeTaskResult["route"],
    durationMs: number,
    firstEventIndex: number,
    extra: Pick<RuntimeTaskResult, "output" | "skill"> = {},
  ): RuntimeTaskResult {
    return {
      route,
      durationMs,
      events: this.eventHistory.slice(firstEventIndex),
      ...extra,
    };
  }
}
