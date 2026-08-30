import { describe, expect, it, vi } from "vitest";
import type {
  JsonObject,
  ModelContextLike,
  RegisteredWebMCPTool,
} from "../shared/types";
import { installDemoWebMCP } from "./mock-webmcp";

const api = {
  listTasks: () => [],
  createTask: (input: JsonObject) => ({
    id: "task-1",
    title: String(input.title ?? "Untitled"),
    description: "",
    priority: "medium" as const,
    assignee: "Ada",
    project: "Runtime",
    status: "todo" as const,
    label: "demo",
    estimate: "3",
    dueDate: "",
    createdAt: Date.now(),
  }),
};

describe("demo WebMCP installation", () => {
  it("installs a local model context when the browser has none", async () => {
    const doc = document.implementation.createHTMLDocument("demo");
    const context = installDemoWebMCP(api, doc);

    expect(doc.modelContext).toBe(context);
    await expect(context.getTools()).resolves.toEqual([
      expect.objectContaining({ name: "search_tasks" }),
    ]);
  });

  it("reuses a non-configurable native model context instead of redefining it", async () => {
    const doc = document.implementation.createHTMLDocument("native-demo");
    const tools: RegisteredWebMCPTool[] = [];
    const registerTool = vi.fn(
      async (tool: RegisteredWebMCPTool, options?: { signal?: AbortSignal }) => {
        tools.push(tool);
        options?.signal?.addEventListener(
          "abort",
          () => {
            const index = tools.findIndex((item) => item.name === tool.name);
            if (index >= 0) tools.splice(index, 1);
          },
          { once: true },
        );
      },
    );
    const nativeContext: ModelContextLike = {
      getTools: vi.fn(async () => tools),
      registerTool,
    };
    Object.defineProperty(doc, "modelContext", {
      value: nativeContext,
      configurable: false,
      writable: false,
    });

    const context = installDemoWebMCP(api, doc);
    await vi.waitFor(() => expect(tools.map((tool) => tool.name)).toContain("search_tasks"));

    expect(doc.modelContext).toBe(nativeContext);
    expect(context).not.toBe(nativeContext);
    expect(registerTool).toHaveBeenCalledTimes(1);

    await context.unregisterTool("search_tasks");
    expect(tools).toHaveLength(0);
  });
});
