import { beforeEach, describe, expect, it } from "vitest";
import type { WebSkill } from "../shared/types";
import { SkillRegistry } from "./skill-registry";

function skill(version = 1): WebSkill {
  const now = Date.now();
  return {
    id: "persistent-skill",
    domain: "example.test",
    urlPattern: "/tasks/*",
    name: "create_task",
    description: "Create a task",
    inputSchema: {},
    workflow: [{ action: "click", target: { role: "button", name: "Create" } }],
    dependencies: [],
    fingerprint: {
      urlPattern: "/tasks/*",
      landmarks: [],
      fingerprintHash: `hash-${version}`,
      capturedAt: now,
    },
    validation: { type: "text-contains", value: "done" },
    version,
    successRate: 1,
    runCount: 1,
    successCount: 1,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

describe("IndexedDB Skill Registry", () => {
  let registry: SkillRegistry;
  beforeEach(async () => {
    registry = new SkillRegistry(`test-registry-${Math.random().toString(16).slice(2)}`);
  });

  it("persists current skills and immutable version snapshots", async () => {
    await registry.save(skill(1));
    await registry.save(skill(2));
    await expect(registry.findMatching("https://example.test/tasks/42", "create_task"))
      .resolves.toMatchObject({ version: 2 });
    await expect(registry.getVersions("persistent-skill")).resolves.toHaveLength(2);
    await registry.recordOutcome("persistent-skill", true);
    await expect(registry.get("persistent-skill")).resolves.toMatchObject({
      runCount: 2,
      successCount: 2,
      successRate: 1,
    });
  });
});
