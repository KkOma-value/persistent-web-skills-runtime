import OpenAI from "openai";
import { z } from "zod";
import { stableStringify } from "../shared/hash";
import type {
  AgentToolDecision,
  JsonObject,
  RepairContext,
  SemanticLocator,
  SkillStep,
  WebSkill,
} from "../shared/types";

const locatorSchema = z
  .object({
    role: z.string().optional(),
    name: z.string().optional(),
    label: z.string().optional(),
    attributes: z.record(z.string()).optional(),
    text: z.string().optional(),
    css: z.string().optional(),
  })
  .refine((locator) => Object.values(locator).some((value) => value !== undefined), {
    message: "A semantic locator must contain at least one strategy",
  });

const stepSchema = z.object({
  action: z.enum(["click", "type", "select", "navigate", "wait"]),
  target: locatorSchema.optional(),
  value: z.string().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
});

const validationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("url-match"), value: z.string().min(1) }),
  z.object({ type: z.literal("element-exists"), locator: locatorSchema }),
  z.object({ type: z.literal("element-not-exists"), locator: locatorSchema }),
  z.object({
    type: z.literal("text-contains"),
    value: z.string().min(1),
    locator: locatorSchema.optional(),
  }),
  z.object({
    type: z.literal("attribute-equals"),
    locator: locatorSchema,
    attribute: z.string().min(1),
    value: z.string(),
  }),
]);

const skillDraftSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().min(1).max(500),
  inputSchema: z.record(z.unknown()),
  workflow: z.array(stepSchema).min(1).max(100),
  dependencies: z.array(
    z.object({
      id: z.string().min(1),
      description: z.string().min(1),
      locator: locatorSchema,
      required: z.boolean(),
    }),
  ),
  validation: validationSchema,
});

const repairDraftSchema = z.object({
  stepIndex: z.number().int().nonnegative(),
  patchedLocator: locatorSchema,
  reason: z.string().min(1).max(500),
});

const decisionSchema = z.object({
  toolName: z.string().nullable().optional(),
  input: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
});

export type SkillDraft = z.infer<typeof skillDraftSchema>;

export interface AIServiceOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  client?: OpenAI;
}

function parseJson<T>(value: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Model output failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== null)
        .map(([key, entry]) => [key, stripNulls(entry)]),
    );
  }
  return value;
}

function normalizeLocator(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const locator = value as Record<string, unknown>;
  if (locator.locator && typeof locator.locator === "object") return locator.locator;
  if (locator.target && typeof locator.target === "object") return locator.target;
  if (locator.selector && typeof locator.selector === "string") return { css: locator.selector };
  return locator;
}

function parseSkillDraft(value: string, fallbackValidation?: unknown): SkillDraft {
  let parsed: unknown;
  try {
    parsed = stripNulls(JSON.parse(value));
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  if (parsed && typeof parsed === "object") {
    const root = parsed as Record<string, unknown>;
    if (root.skill && typeof root.skill === "object") parsed = root.skill;
    else if (root.draft && typeof root.draft === "object") parsed = root.draft;
  }
  if (parsed && typeof parsed === "object") {
    const candidate = parsed as Record<string, unknown>;
    // Accept common model aliases, then validate one canonical contract.
    if (!candidate.inputSchema && candidate.input_schema) candidate.inputSchema = candidate.input_schema;
    if (!candidate.inputSchema) {
      candidate.inputSchema = { type: "object", properties: {}, required: [] };
    }
    if (!candidate.workflow && candidate.steps) candidate.workflow = candidate.steps;
    if (!candidate.workflow && candidate.actions) candidate.workflow = candidate.actions;
    if (Array.isArray(candidate.workflow)) {
      candidate.workflow = candidate.workflow.map((step) => {
        if (!step || typeof step !== "object") return step;
        const item = step as Record<string, unknown>;
        return {
          ...item,
          target: normalizeLocator(item.target ?? item.locator),
        };
      });
    }
    if (!Array.isArray(candidate.dependencies) && candidate.dependencies) {
      const dependencies = candidate.dependencies as Record<string, unknown>;
      const requiredElements = Array.isArray(dependencies.requiredElements)
        ? dependencies.requiredElements
        : [];
      candidate.dependencies = requiredElements.map((locator, index) => ({
        id: `dependency-${index + 1}`,
        description: "Model-identified page dependency",
        locator: normalizeLocator(locator),
        required: true,
      }));
    }
    if (!Array.isArray(candidate.dependencies)) {
      const seen = new Set<string>();
      const derived = (Array.isArray(candidate.workflow) ? candidate.workflow : [])
        .map((step) => (step && typeof step === "object" ? (step as Record<string, unknown>).target : undefined))
        .filter(Boolean)
        .map((locator, index) => {
          const normalizedLocator = normalizeLocator(locator);
          const key = JSON.stringify(normalizedLocator);
          if (seen.has(key)) return undefined;
          seen.add(key);
          return {
            id: `dependency-${index + 1}`,
            description: "Workflow target dependency",
            locator: normalizedLocator,
            required: true,
          };
        })
        .filter(Boolean);
      candidate.dependencies = derived;
    }
    const validation = candidate.validation ?? fallbackValidation ?? {
      type: "text-contains",
      value: "completed",
    };
    if (validation && typeof validation === "object") {
      const validationObject = validation as Record<string, unknown>;
      if (!validationObject.locator && validationObject.target) {
        validationObject.locator = normalizeLocator(validationObject.target);
      }
      delete validationObject.target;
    }
    candidate.validation = validation;
  }
  const result = skillDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Model output failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

function parseRepairDraft(value: string): z.infer<typeof repairDraftSchema> {
  let parsed: unknown;
  try {
    parsed = stripNulls(JSON.parse(value));
  } catch {
    throw new Error("Model returned invalid JSON");
  }
  if (parsed && typeof parsed === "object") {
    const root = parsed as Record<string, unknown>;
    if (root.repair && typeof root.repair === "object") parsed = root.repair;
    else if (root.patch && typeof root.patch === "object") {
      parsed = { ...(root.patch as Record<string, unknown>), reason: root.reason };
    }
  }
  if (parsed && typeof parsed === "object") {
    const candidate = parsed as Record<string, unknown>;
    if (candidate.stepIndex === undefined) {
      const alias = candidate.step ?? candidate.index;
      // Models often number human-facing steps from one; the runtime is zero-based.
      candidate.stepIndex = typeof alias === "number" && candidate.step === alias ? alias - 1 : alias;
    }
    if (!candidate.patchedLocator) {
      candidate.patchedLocator = normalizeLocator(
        candidate.locator ?? candidate.replacementLocator ?? candidate.target,
      );
    }
    if (!candidate.reason) candidate.reason = "Patched the failed semantic target";
  }
  const result = repairDraftSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Model output failed schema validation: ${result.error.message}`);
  }
  return result.data;
}

function jsonSchema(name: string, schema: JsonObject): {
  type: "json_schema";
  name: string;
  strict: true;
  schema: JsonObject;
} {
  return { type: "json_schema", name, strict: true, schema };
}

const locatorJsonSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    role: { type: ["string", "null"] },
    name: { type: ["string", "null"] },
    label: { type: ["string", "null"] },
    attributes: { type: ["object", "null"], additionalProperties: { type: "string" } },
    text: { type: ["string", "null"] },
    css: { type: ["string", "null"] },
  },
  required: ["role", "name", "label", "attributes", "text", "css"],
};

const skillDraftJsonSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    description: { type: "string" },
    inputSchema: { type: "object", additionalProperties: true },
    workflow: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["click", "type", "select", "navigate", "wait"] },
          target: locatorJsonSchema,
          value: { type: ["string", "null"] },
          timeoutMs: { type: ["number", "null"] },
        },
        required: ["action", "target", "value", "timeoutMs"],
      },
    },
    dependencies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          locator: locatorJsonSchema,
          required: { type: "boolean" },
        },
        required: ["id", "description", "locator", "required"],
      },
    },
    validation: { type: "object", additionalProperties: true },
  },
  required: ["name", "description", "inputSchema", "workflow", "dependencies", "validation"],
};

export class AIService {
  readonly configured: boolean;
  readonly model: string;
  private readonly client?: OpenAI;

  constructor(options: AIServiceOptions = {}) {
    this.model = options.model ?? process.env.OPENAI_MODEL ?? "gpt-5.5";
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    this.client =
      options.client ??
      (apiKey
        ? new OpenAI({
            apiKey,
            baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
          })
        : undefined);
    this.configured = Boolean(this.client);
  }

  async decide(request: string, tools: JsonObject[]): Promise<AgentToolDecision> {
    const response = await this.complete(
      "agent-decision",
      `Choose the single best tool for the user's request. Native tools are preferred when names overlap. Return an empty toolName only when no tool is appropriate. Return exactly one JSON object with these keys: toolName (string or null), input (object), confidence (number from 0 to 1). Do not use alternate key names such as tool, arguments, or selectedTool.\n\nUser request:\n${request}\n\nTool catalog:\n${JSON.stringify(tools)}`,
      {
        type: "object",
        additionalProperties: false,
        properties: {
          toolName: { type: ["string", "null"] },
          input: { type: "object", additionalProperties: true },
          confidence: { type: "number" },
        },
        required: ["toolName", "input", "confidence"],
      },
    );
    const decision = parseJson(response, decisionSchema);
    return { ...decision, toolName: decision.toolName ?? undefined };
  }

  async generateSkill(payload: {
    userIntent: string;
    actionTrace: unknown;
    semanticDom: unknown;
    validation: unknown;
  }): Promise<SkillDraft> {
    const response = await this.complete(
      "skill-draft",
      `Abstract a reusable Web Skill from the browser trace. Prefer accessibility role/name, labels, stable attributes, and visible text in that order. Never use coordinates or brittle nth-child selectors. Keep workflow steps limited to the user's intent and keep validation explicit.\n\n${JSON.stringify(payload)}`,
      skillDraftJsonSchema,
    );
    return parseSkillDraft(response, payload.validation);
  }

  async repair(context: RepairContext): Promise<{
    stepIndex: number;
    patchedLocator: SemanticLocator;
    reason: string;
  }> {
    const response = await this.complete(
      "skill-repair",
      `Patch only the failed Web Skill step. Do not rewrite unrelated steps. Match the old semantic intent to the current semantic DOM and return exactly one JSON object with keys stepIndex (integer equal to ${context.failedStepIndex}), patchedLocator (semantic locator object), and reason (string). Do not use alternate keys such as patch, locator, or changes.\n\n${JSON.stringify(context)}`,
      {
        type: "object",
        additionalProperties: false,
        properties: {
          stepIndex: { type: "integer" },
          patchedLocator: locatorJsonSchema,
          reason: { type: "string" },
        },
        required: ["stepIndex", "patchedLocator", "reason"],
      },
    );
    return parseRepairDraft(response);
  }

  private async complete(name: string, prompt: string, schema: JsonObject): Promise<string> {
    if (!this.client) {
      throw new Error("OpenAI API is not configured on the server");
    }
    const result = await this.client.responses.create({
      model: this.model,
      instructions: "You are the server-side reasoning layer for Persistent Web Skills Runtime. Output only the requested JSON.",
      input: prompt,
      // The gateway supports JSON mode but rejects strict schemas containing
      // intentionally open-ended objects (tool inputs and inputSchema). Zod
      // validation below still enforces the response contract server-side.
      text: { format: { type: "json_object" }, verbosity: "low" },
      store: false,
    });
    return result.output_text;
  }
}

export function patchSkillFromRepair(
  skill: WebSkill,
  stepIndex: number,
  patchedLocator: SemanticLocator,
): WebSkill {
  const oldTarget = skill.workflow[stepIndex]?.target;
  if (!oldTarget) throw new Error(`Repair step ${stepIndex} has no target`);
  const oldKey = stableStringify(oldTarget);
  const now = Date.now();
  return {
    ...skill,
    workflow: skill.workflow.map((step: SkillStep, index) =>
      index === stepIndex ? { ...step, target: patchedLocator } : step,
    ),
    dependencies: skill.dependencies.map((dependency) =>
      stableStringify(dependency.locator) === oldKey
        ? { ...dependency, locator: patchedLocator }
        : dependency,
    ),
    version: skill.version + 1,
    updatedAt: now,
  };
}
