import { beforeEach, describe, expect, it } from "vitest";
import type {
  BrowserLearningAgent,
  JsonObject,
  LearnResult,
  NativeToolSnapshot,
  SkillStep,
  ValidationRule,
  WebSkill,
} from "../../../shared/types";
import { capturePageFingerprint } from "../page/fingerprint";
import { captureSemanticDom } from "../page/semantic-dom";
import { buildSkillFromTrace } from "./skill-builder";
import { executeSkill } from "./skill-executor";
import {
  DirectNativeToolRuntime,
  RuntimeOrchestrator,
  type NativeToolRuntime,
} from "./orchestrator";
import { ToolCatalog } from "./tool-catalog";
import { validateResult } from "./validator";
import { MemorySkillRegistry } from "../../../storage/skill-registry";

const workflow: SkillStep[] = [
  { action: "type", target: { role: "textbox", name: "Title" }, value: "{{title}}" },
  { action: "click", target: { role: "button", name: "Create Task" } },
];
const validation: ValidationRule = {
  type: "element-exists",
  locator: { role: "listitem", name: "{{title}}" },
};

function renderTaskSite(buttonLabel = "Create Task") {
  document.body.innerHTML = `
    <main>
      <form aria-label="Task form">
        <label for="title">Title</label>
        <input id="title" aria-label="Title" name="title" />
        <button type="button">${buttonLabel}</button>
      </form>
      <ul aria-label="Tasks"></ul>
    </main>`;
  document.querySelector("button")!.addEventListener("click", () => {
    const item = document.createElement("li");
    item.setAttribute("aria-label", (document.querySelector("input") as HTMLInputElement).value);
    document.querySelector("ul")!.append(item);
  });
}

class EmptyNativeRuntime implements NativeToolRuntime {
  async discover() {
    return { available: false, tools: [] as NativeToolSnapshot[] };
  }
  async execute() {
    throw new Error("No native tools");
  }
}

class TraceLearningAgent implements BrowserLearningAgent {
  async learn(_request: string, input: JsonObject): Promise<LearnResult> {
    const draft: WebSkill = {
      id: "learned-create-task",
      domain: document.location.hostname,
      urlPattern: "/",
      name: "create_task",
      description: "Create a task",
      inputSchema: { type: "object" },
      workflow,
      dependencies: [],
      fingerprint: capturePageFingerprint([], "/", document),
      validation,
      version: 0,
      successRate: 0,
      runCount: 0,
      successCount: 0,
      lastVerifiedAt: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const execution = await executeSkill(draft, input, { document });
    const result = await validateResult(validation, input, document);
    const skill = buildSkillFromTrace({
      name: "create_task",
      description: "Create a task",
      inputSchema: { type: "object" },
      trace: execution.trace,
      validation,
      document,
      urlPattern: "/",
      id: "learned-create-task",
    });
    return { skill, trace: execution.trace, validation: result };
  }
}

describe("runtime orchestration", () => {
  beforeEach(() => {
    renderTaskSite();
  });

  it("completes Learn → Reuse → Repair and stores a new version", async () => {
    const registry = new MemorySkillRegistry();
    const runtime = new RuntimeOrchestrator({
      registry,
      learningAgent: new TraceLearningAgent(),
      nativeRuntime: new EmptyNativeRuntime(),
      document,
      repairEngine: new (await import("./repair-engine")).RepairEngine({
        minimumLocalScore: 0.45,
      }),
    });
    await runtime.initialize();

    await expect(
      runtime.executeTask("Create task", { title: "First task" }, { toolName: "create_task" }),
    ).resolves.toMatchObject({ route: "learned-skill" });
    await expect(
      runtime.executeTask("Create task", { title: "Second task" }, { toolName: "create_task" }),
    ).resolves.toMatchObject({ route: "cached-skill" });

    renderTaskSite("Add Task");
    await expect(
      runtime.executeTask("Create task", { title: "Recovered task" }, { toolName: "create_task" }),
    ).resolves.toMatchObject({ route: "repaired-skill" });
    await expect(registry.getVersions("learned-create-task")).resolves.toHaveLength(2);
    await expect(registry.get("learned-create-task")).resolves.toMatchObject({ version: 2 });
    runtime.destroy();
  });

  it("always resolves a native tool before a learned tool with the same name", () => {
    const catalog = new ToolCatalog();
    catalog.syncNative([
      {
        id: "native:example:create_task",
        name: "create_task",
        description: "Native",
        origin: "https://example.test",
        hash: "a",
        lastSeen: Date.now(),
      },
    ]);
    catalog.syncSkills([
      {
        id: "skill",
        domain: "example.test",
        urlPattern: "/",
        name: "create_task",
        description: "Learned",
        inputSchema: {},
        workflow: [],
        dependencies: [],
        fingerprint: { urlPattern: "/", landmarks: [], fingerprintHash: "", capturedAt: 0 },
        validation: { type: "text-contains", value: "done" },
        version: 1,
        successRate: 1,
        runCount: 1,
        successCount: 1,
        lastVerifiedAt: 0,
        createdAt: 0,
        updatedAt: 0,
      },
    ]);
    expect(catalog.resolve("create_task")?.source).toBe("native-webmcp");
  });
});
