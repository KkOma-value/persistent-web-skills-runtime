import type {
  ActionTraceStep,
  JsonObject,
  SkillDependency,
  ValidationRule,
  WebSkill,
} from "../../../shared/types";
import { deriveUrlPattern } from "../../../shared/url";
import { capturePageFingerprint } from "../page/fingerprint";

export interface BuildSkillOptions {
  id?: string;
  name: string;
  description: string;
  inputSchema: JsonObject;
  trace: ActionTraceStep[];
  validation: ValidationRule;
  document?: Document;
  urlPattern?: string;
}

export function buildSkillFromTrace(options: BuildSkillOptions): WebSkill {
  const doc = options.document ?? document;
  const workflow = options.trace
    .filter((step) => step.outcome === "success")
    .map(({ timestamp: _timestamp, durationMs: _duration, outcome: _outcome, error: _error, ...step }) => step);
  const locatorKeys = new Set<string>();
  const dependencies: SkillDependency[] = [];

  for (const step of workflow) {
    if (!step.target) continue;
    const key = JSON.stringify(step.target);
    if (locatorKeys.has(key)) continue;
    locatorKeys.add(key);
    dependencies.push({
      id: `dependency-${dependencies.length + 1}`,
      description: `${step.action} target`,
      locator: step.target,
      required: true,
    });
  }

  const urlPattern = options.urlPattern ?? deriveUrlPattern(doc.location.href);
  const now = Date.now();
  return {
    id: options.id ?? crypto.randomUUID(),
    domain: doc.location.hostname,
    urlPattern,
    name: options.name,
    description: options.description,
    inputSchema: options.inputSchema,
    workflow,
    dependencies,
    fingerprint: capturePageFingerprint(dependencies, urlPattern, doc),
    validation: options.validation,
    version: 1,
    successRate: 1,
    runCount: 1,
    successCount: 1,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}
