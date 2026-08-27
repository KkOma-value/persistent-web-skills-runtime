import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { AIService, patchSkillFromRepair } from "./ai";
import type { WebSkill } from "../shared/types";

function fakeClient(output: string): OpenAI {
  return {
    responses: { create: vi.fn(async () => ({ output_text: output })) },
  } as unknown as OpenAI;
}

describe("server AI contract", () => {
  it("normalizes equivalent model skill shapes before validation", async () => {
    const service = new AIService({ client: fakeClient(JSON.stringify({
      name: "create_task",
      description: "Create a task",
      steps: [{ step: 1, action: "click", target: { role: "button", name: "Create Task" } }],
      dependencies: {
        requiredElements: [{ role: "button", name: "Create Task" }],
      },
      validation: { type: "element-exists", target: { text: "Created" } },
    })) });
    const draft = await service.generateSkill({
      userIntent: "Create a task",
      actionTrace: [],
      semanticDom: {},
      validation: {},
    });
    expect(draft.workflow).toHaveLength(1);
    expect(draft.dependencies).toHaveLength(1);
    expect(draft.validation).toEqual({ type: "element-exists", locator: { text: "Created" } });
  });

  it("normalizes repair aliases and patches only the failed step", async () => {
    const service = new AIService({
      client: fakeClient(JSON.stringify({
        patch: {
          step: 2,
          locator: { role: "button", name: "Add Task" },
        },
        reason: "Renamed button",
      })),
    });
    const patch = await service.repair({
      oldSkill: {
        id: "skill",
        domain: "example.test",
        urlPattern: "/",
        name: "create_task",
        description: "Create",
        inputSchema: {},
        workflow: [
          { action: "type", target: { role: "textbox", name: "Title" } },
          { action: "click", target: { role: "button", name: "Create Task" } },
        ],
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
      failedStepIndex: 1,
      failureReason: "renamed",
      oldFingerprint: { urlPattern: "/", landmarks: [], fingerprintHash: "", capturedAt: 0 },
      currentSemanticDom: { url: "https://example.test", title: "", elements: [], capturedAt: 0 },
    });
    expect(patch.stepIndex).toBe(1);
    const skill: WebSkill = {
      id: "skill",
      domain: "example.test",
      urlPattern: "/",
      name: "create_task",
      description: "Create",
      inputSchema: {},
      workflow: [
        { action: "type", target: { role: "textbox", name: "Title" } },
        { action: "click", target: { role: "button", name: "Create Task" } },
      ],
      dependencies: [{ id: "button", description: "button", locator: { role: "button", name: "Create Task" }, required: true }],
      fingerprint: { urlPattern: "/", landmarks: [], fingerprintHash: "", capturedAt: 0 },
      validation: { type: "text-contains", value: "done" },
      version: 1,
      successRate: 1,
      runCount: 1,
      successCount: 1,
      lastVerifiedAt: 0,
      createdAt: 0,
      updatedAt: 0,
    };
    const patched = patchSkillFromRepair(skill, patch.stepIndex, patch.patchedLocator);
    expect(patched.version).toBe(2);
    expect(patched.workflow[0].target).toEqual(skill.workflow[0].target);
    expect(patched.workflow[1].target).toEqual({ role: "button", name: "Add Task" });
    expect(patched.dependencies[0].locator).toEqual({ role: "button", name: "Add Task" });
  });
});
