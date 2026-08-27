import type {
  BrowserLearningAgent,
  JsonObject,
  SkillStep,
  ValidationRule,
  WebSkill,
} from "../shared/types";
import { capturePageFingerprint } from "../extension/content/page/fingerprint";
import { buildSkillFromTrace } from "../extension/content/runtime/skill-builder";
import { executeSkill } from "../extension/content/runtime/skill-executor";
import { validateResult } from "../extension/content/runtime/validator";

const CREATE_TASK_WORKFLOW: SkillStep[] = [
  { action: "type", target: { role: "textbox", name: "Task title" }, value: "{{title}}" },
  {
    action: "type",
    target: { role: "textbox", name: "Description" },
    value: "{{description}}",
  },
  { action: "select", target: { role: "combobox", name: "Priority" }, value: "{{priority}}" },
  { action: "select", target: { role: "combobox", name: "Assignee" }, value: "{{assignee}}" },
  { action: "select", target: { role: "combobox", name: "Project" }, value: "{{project}}" },
  { action: "select", target: { role: "combobox", name: "Status" }, value: "{{status}}" },
  { action: "type", target: { role: "textbox", name: "Label" }, value: "{{label}}" },
  { action: "type", target: { role: "textbox", name: "Estimate" }, value: "{{estimate}}" },
  { action: "type", target: { role: "textbox", name: "Due date" }, value: "{{dueDate}}" },
  { action: "wait", target: { role: "main" }, timeoutMs: 1_000 },
  { action: "click", target: { role: "button", name: "Create Task" } },
];

const VALIDATION: ValidationRule = {
  type: "element-exists",
  locator: { role: "listitem", name: "{{title}}" },
};

function ephemeralSkill(doc: Document): WebSkill {
  const now = Date.now();
  return {
    id: "learning-trace",
    domain: doc.location.hostname,
    urlPattern: doc.location.pathname,
    name: "create_task",
    description: "Learning trace",
    inputSchema: {},
    workflow: CREATE_TASK_WORKFLOW,
    dependencies: [],
    fingerprint: capturePageFingerprint([], doc.location.pathname, doc),
    validation: VALIDATION,
    version: 0,
    successRate: 0,
    runCount: 0,
    successCount: 0,
    lastVerifiedAt: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export class DemoLearningAgent implements BrowserLearningAgent {
  constructor(private readonly doc: Document = document) {}

  async learn(_request: string, input: JsonObject) {
    // The demo keeps a small, visible observation window so Learn vs Reuse timing is legible.
    await new Promise((resolve) => window.setTimeout(resolve, 520));
    const execution = await executeSkill(ephemeralSkill(this.doc), input, {
      document: this.doc,
    });
    if (!execution.success) {
      throw new Error(`Browser learning trace failed: ${execution.error}`);
    }
    const validation = await validateResult(VALIDATION, input, this.doc);
    const skill = buildSkillFromTrace({
      name: "create_task",
      description: "Create a structured task using the current site's task editor",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          priority: { type: "string" },
          assignee: { type: "string" },
          project: { type: "string" },
          status: { type: "string" },
          label: { type: "string" },
          estimate: { type: "string" },
          dueDate: { type: "string" },
        },
        required: ["title"],
      },
      trace: execution.trace,
      validation: VALIDATION,
      document: this.doc,
      urlPattern: this.doc.location.pathname,
    });
    return {
      skill,
      trace: execution.trace,
      validation,
      output: { title: input.title, learnedActions: execution.trace.length },
    };
  }
}
