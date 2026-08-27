import { describe, expect, it } from "vitest";
import type { SkillDependency, WebSkill } from "../../../shared/types";
import { capturePageFingerprint, validatePageFingerprint } from "./fingerprint";
import {
  accessibleName,
  captureSemanticDom,
  resolveSemanticLocator,
} from "./semantic-dom";
import { validateResult } from "../runtime/validator";

function baseSkill(doc: Document): WebSkill {
  const dependencies: SkillDependency[] = [
    {
      id: "submit",
      description: "submit button",
      locator: { role: "button", name: "Create Task" },
      required: true,
    },
  ];
  const now = Date.now();
  return {
    id: "skill-1",
    domain: doc.location.hostname,
    urlPattern: "/tasks",
    name: "create_task",
    description: "Create a task",
    inputSchema: {},
    workflow: [{ action: "click", target: dependencies[0].locator }],
    dependencies,
    fingerprint: capturePageFingerprint(dependencies, "/tasks", doc),
    validation: { type: "element-exists", locator: { text: "Created" } },
    version: 1,
    successRate: 1,
    runCount: 1,
    successCount: 1,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("semantic DOM and validation", () => {
  it("resolves accessible role/name before CSS and ignores dynamic page copy", () => {
    document.body.innerHTML = `
      <main>
        <button aria-label="Add to cart" class="random-42">Add to cart</button>
        <button class="random-43">Reset</button>
      </main>`;
    const button = resolveSemanticLocator({ role: "button", name: "Add to cart" });
    expect(button?.getAttribute("aria-label")).toBe("Add to cart");
    expect(accessibleName(button!)).toBe("Add to cart");
  });

  it("marks only dependency drift as fingerprint incompatibility", () => {
    document.body.innerHTML = `<main><button role="button">Create Task</button><p>Ad ${Date.now()}</p></main>`;
    const skill = baseSkill(document);
    expect(validatePageFingerprint(skill, document).valid).toBe(true);
    document.querySelector("button")!.textContent = "Add Task";
    const result = validatePageFingerprint(skill, document);
    expect(result.valid).toBe(false);
    expect(result.missingDependencyIds).toEqual(["submit"]);
  });

  it("requires an explicit validation rule instead of treating execution as success", async () => {
    document.body.innerHTML = `<main><p>Not done yet</p></main>`;
    await expect(
      validateResult({ type: "element-exists", locator: { text: "Created" } }, {}, document),
    ).resolves.toMatchObject({ valid: false });
    document.body.innerHTML = `<main><p>Created</p></main>`;
    await expect(
      validateResult({ type: "text-contains", value: "created" }, {}, document),
    ).resolves.toMatchObject({ valid: true });
  });

  it("captures a compact semantic DOM instead of full HTML", () => {
    document.body.innerHTML = `<main><h1>Tasks</h1><button>Go</button><div>${"x".repeat(5000)}</div></main>`;
    const snapshot = captureSemanticDom(document);
    expect(snapshot.elements.some((element) => element.role === "button")).toBe(true);
    expect(snapshot.elements.every((element) => (element.text?.length ?? 0) <= 200)).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain("x".repeat(500));
  });
});
