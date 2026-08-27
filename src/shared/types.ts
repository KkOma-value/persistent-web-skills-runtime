export type JsonObject = Record<string, unknown>;

export type ToolSource = "native-webmcp" | "learned-skill";

export interface RuntimeTool {
  id: string;
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  source: ToolSource;
  origin: string;
  hash?: string;
  lastSeen?: number;
  skillId?: string;
}

export interface NativeToolSnapshot {
  id: string;
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  origin: string;
  hash: string;
  lastSeen: number;
}

export interface RegisteredWebMCPTool {
  name: string;
  description?: string;
  inputSchema?: JsonObject;
  execute?: (input: JsonObject) => unknown | Promise<unknown>;
  invoke?: (input: JsonObject) => unknown | Promise<unknown>;
  handler?: (input: JsonObject) => unknown | Promise<unknown>;
}

export interface ModelContextLike extends EventTarget {
  getTools(): Promise<RegisteredWebMCPTool[]>;
}

export interface SemanticLocator {
  role?: string;
  name?: string;
  label?: string;
  attributes?: Record<string, string>;
  text?: string;
  css?: string;
}

export type SkillAction = "click" | "type" | "select" | "navigate" | "wait";

export interface SkillStep {
  id?: string;
  action: SkillAction;
  target?: SemanticLocator;
  value?: string;
  timeoutMs?: number;
}

export interface SkillDependency {
  id: string;
  description: string;
  locator: SemanticLocator;
  required: boolean;
}

export interface FingerprintLandmark {
  dependencyId: string;
  locator: SemanticLocator;
  matched: boolean;
  signature?: string;
}

export interface PageFingerprint {
  urlPattern: string;
  landmarks: FingerprintLandmark[];
  fingerprintHash: string;
  capturedAt: number;
}

export type ValidationRule =
  | { type: "url-match"; value: string }
  | { type: "element-exists"; locator: SemanticLocator }
  | { type: "element-not-exists"; locator: SemanticLocator }
  | { type: "text-contains"; value: string; locator?: SemanticLocator }
  | {
      type: "attribute-equals";
      locator: SemanticLocator;
      attribute: string;
      value: string;
    };

export interface WebSkill {
  id: string;
  domain: string;
  urlPattern: string;
  name: string;
  description: string;
  inputSchema: JsonObject;
  workflow: SkillStep[];
  dependencies: SkillDependency[];
  fingerprint: PageFingerprint;
  validation: ValidationRule;
  version: number;
  successRate: number;
  runCount: number;
  successCount: number;
  lastVerifiedAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogDiff {
  added: RuntimeTool[];
  removed: RuntimeTool[];
  changed: RuntimeTool[];
}

export type RuntimePhase =
  | "discover"
  | "native"
  | "memory"
  | "validate"
  | "execute"
  | "learn"
  | "repair"
  | "complete"
  | "error";

export interface RuntimeEvent {
  id: string;
  timestamp: number;
  phase: RuntimePhase;
  title: string;
  detail?: string;
  status: "pending" | "success" | "warning" | "error" | "info";
  metadata?: JsonObject;
}

export interface ActionTraceStep extends SkillStep {
  timestamp: number;
  durationMs?: number;
  outcome: "success" | "failure";
  error?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason: string;
}

export interface FingerprintValidationResult extends ValidationResult {
  score: number;
  missingDependencyIds: string[];
  currentFingerprint: PageFingerprint;
}

export interface SkillExecutionResult {
  success: boolean;
  trace: ActionTraceStep[];
  failedStepIndex?: number;
  error?: string;
  durationMs: number;
}

export interface RepairContext {
  oldSkill: WebSkill;
  failedStepIndex: number;
  failureReason: string;
  oldFingerprint: PageFingerprint;
  currentSemanticDom: SemanticDomSnapshot;
  screenshotDataUrl?: string;
}

export interface SkillRepairResult {
  patchedSkill: WebSkill;
  changes: Array<{
    stepIndex: number;
    before?: SemanticLocator;
    after?: SemanticLocator;
  }>;
  reason: string;
  strategy: "local-semantic" | "server-model";
}

export interface SemanticElementSnapshot {
  tag: string;
  role?: string;
  name?: string;
  label?: string;
  text?: string;
  attributes: Record<string, string>;
}

export interface SemanticDomSnapshot {
  url: string;
  title: string;
  elements: SemanticElementSnapshot[];
  capturedAt: number;
}

export interface LearnResult {
  skill: WebSkill;
  trace: ActionTraceStep[];
  validation: ValidationResult;
  output?: unknown;
}

export interface BrowserLearningAgent {
  learn(request: string, input: JsonObject): Promise<LearnResult>;
}

export interface RuntimeTaskResult {
  route: "native-webmcp" | "cached-skill" | "learned-skill" | "repaired-skill";
  output?: unknown;
  skill?: WebSkill;
  durationMs: number;
  events: RuntimeEvent[];
}

export interface RuntimeSnapshot {
  origin: string;
  url: string;
  nativeTools: RuntimeTool[];
  learnedSkills: WebSkill[];
  events: RuntimeEvent[];
  updatedAt: number;
}

export interface AgentToolDecision {
  toolName?: string;
  input: JsonObject;
  confidence: number;
}

declare global {
  interface Document {
    modelContext?: ModelContextLike;
  }
}

export {};
