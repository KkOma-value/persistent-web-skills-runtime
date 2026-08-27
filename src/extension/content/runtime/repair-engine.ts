import { stableStringify } from "../../../shared/hash";
import type {
  RepairContext,
  SemanticElementSnapshot,
  SemanticLocator,
  SkillRepairResult,
  WebSkill,
} from "../../../shared/types";

function tokens(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) return 1;
  const intersection = [...left].filter((value) => right.has(value)).length;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

const TOKEN_SYNONYMS: Record<string, string[]> = {
  add: ["create", "new"],
  create: ["add", "new"],
  remove: ["delete", "clear"],
  delete: ["remove", "clear"],
  save: ["submit", "create"],
  submit: ["save", "create"],
};

function semanticTokenScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let matches = 0;
  for (const token of left) {
    if (right.has(token) || TOKEN_SYNONYMS[token]?.some((synonym) => right.has(synonym))) {
      matches += 1;
    }
  }
  return matches / Math.max(left.size, right.size);
}

function editSimilarity(left = "", right = ""): number {
  const a = left.toLocaleLowerCase();
  const b = right.toLocaleLowerCase();
  if (a === b) return 1;
  if (!a || !b) return 0;
  const rows = Array.from({ length: a.length + 1 }, (_, index) => index);
  for (let column = 1; column <= b.length; column += 1) {
    let previousDiagonal = rows[0];
    rows[0] = column;
    for (let row = 1; row <= a.length; row += 1) {
      const previousRow = rows[row];
      rows[row] = Math.min(
        rows[row] + 1,
        rows[row - 1] + 1,
        previousDiagonal + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      previousDiagonal = previousRow;
    }
  }
  return 1 - rows[a.length] / Math.max(a.length, b.length);
}

function primaryText(locator: SemanticLocator): string | undefined {
  return locator.name ?? locator.label ?? locator.text;
}

function locatorForSnapshot(element: SemanticElementSnapshot): SemanticLocator | undefined {
  if (element.role && element.name) return { role: element.role, name: element.name };
  if (element.label) return { label: element.label };
  if (Object.keys(element.attributes).length > 0) {
    return { attributes: element.attributes };
  }
  if (element.text) return { text: element.text };
  return undefined;
}

function candidateScore(oldLocator: SemanticLocator, element: SemanticElementSnapshot): number {
  const candidate = locatorForSnapshot(element);
  if (!candidate) return 0;
  let score = 0;

  if (oldLocator.role) {
    if (oldLocator.role !== element.role) return 0;
    score += 0.4;
  } else if (element.role) {
    score += 0.05;
  }

  const oldText = primaryText(oldLocator);
  const newText = primaryText(candidate);
  if (oldText && newText) {
    const oldTokens = tokens(oldText);
    const newTokens = tokens(newText);
    score += 0.18 * jaccard(oldTokens, newTokens);
    score += 0.22 * semanticTokenScore(oldTokens, newTokens);
    score += 0.2 * editSimilarity(oldText, newText);
  }

  if (oldLocator.attributes && candidate.attributes) {
    const entries = Object.entries(oldLocator.attributes);
    const matches = entries.filter(
      ([name, value]) => candidate.attributes?.[name] === value,
    ).length;
    if (entries.length > 0) score += 0.35 * (matches / entries.length);
  }

  if (oldLocator.label && element.label) score += 0.05;
  return Math.min(1, score);
}

function patchSkill(
  oldSkill: WebSkill,
  stepIndex: number,
  replacement: SemanticLocator,
): WebSkill {
  const oldTarget = oldSkill.workflow[stepIndex]?.target;
  if (!oldTarget) throw new Error(`Failed step ${stepIndex} has no semantic target`);
  const oldKey = stableStringify(oldTarget);
  const now = Date.now();
  return {
    ...oldSkill,
    workflow: oldSkill.workflow.map((step, index) =>
      index === stepIndex ? { ...step, target: replacement } : step,
    ),
    dependencies: oldSkill.dependencies.map((dependency) =>
      stableStringify(dependency.locator) === oldKey
        ? { ...dependency, locator: replacement }
        : dependency,
    ),
    version: oldSkill.version + 1,
    updatedAt: now,
  };
}

export interface RepairEngineOptions {
  endpoint?: string;
  minimumLocalScore?: number;
  fetchImpl?: typeof fetch;
}

export class RepairEngine {
  private readonly endpoint?: string;
  private readonly minimumLocalScore: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RepairEngineOptions = {}) {
    this.endpoint = options.endpoint;
    this.minimumLocalScore = options.minimumLocalScore ?? 0.5;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async repair(context: RepairContext): Promise<SkillRepairResult> {
    const failedStep = context.oldSkill.workflow[context.failedStepIndex];
    if (!failedStep?.target) {
      throw new Error(`Cannot repair step ${context.failedStepIndex}: no target locator`);
    }

    const ranked = context.currentSemanticDom.elements
      .map((element) => ({
        element,
        locator: locatorForSnapshot(element),
        score: candidateScore(failedStep.target!, element),
      }))
      .filter(
        (candidate): candidate is typeof candidate & { locator: SemanticLocator } =>
          Boolean(candidate.locator),
      )
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];

    if (best && best.score >= this.minimumLocalScore) {
      return {
        patchedSkill: patchSkill(
          context.oldSkill,
          context.failedStepIndex,
          best.locator,
        ),
        changes: [
          {
            stepIndex: context.failedStepIndex,
            before: failedStep.target,
            after: best.locator,
          },
        ],
        reason: `Matched the failed target to the closest semantic element (${Math.round(
          best.score * 100,
        )}% confidence)`,
        strategy: "local-semantic",
      };
    }

    if (!this.endpoint) {
      throw new Error("No trustworthy local repair candidate and no repair API configured");
    }
    return this.repairWithServer(context);
  }

  private async repairWithServer(context: RepairContext): Promise<SkillRepairResult> {
    const response = await this.fetchImpl(this.endpoint!, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(context),
    });
    if (!response.ok) {
      throw new Error(`Repair API failed (${response.status}): ${await response.text()}`);
    }
    const result = (await response.json()) as SkillRepairResult;
    if (
      !result?.patchedSkill ||
      result.patchedSkill.id !== context.oldSkill.id ||
      result.patchedSkill.version !== context.oldSkill.version + 1 ||
      !Array.isArray(result.changes)
    ) {
      throw new Error("Repair API returned an invalid patch");
    }
    return { ...result, strategy: "server-model" };
  }
}

export async function repairSkill(
  oldSkill: WebSkill,
  context: Omit<RepairContext, "oldSkill">,
  options?: RepairEngineOptions,
): Promise<SkillRepairResult> {
  return new RepairEngine(options).repair({ ...context, oldSkill });
}
