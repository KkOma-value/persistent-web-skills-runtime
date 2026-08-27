import type {
  JsonObject,
  ModelContextLike,
  RegisteredWebMCPTool,
} from "../shared/types";
import type { DemoTask } from "./types";

export class DemoModelContext extends EventTarget implements ModelContextLike {
  private readonly tools = new Map<string, RegisteredWebMCPTool>();

  async getTools(): Promise<RegisteredWebMCPTool[]> {
    return [...this.tools.values()];
  }

  registerTool(tool: RegisteredWebMCPTool): void {
    this.tools.set(tool.name, tool);
    this.dispatchEvent(new Event("toolchange"));
  }

  unregisterTool(name: string): void {
    if (this.tools.delete(name)) this.dispatchEvent(new Event("toolchange"));
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export interface DemoWebMCPApi {
  listTasks: () => DemoTask[];
  createTask: (input: JsonObject) => DemoTask;
}

export function installDemoWebMCP(api: DemoWebMCPApi): DemoModelContext {
  const context = new DemoModelContext();
  context.registerTool({
    name: "search_tasks",
    description: "Search the task board by title, label, status, or assignee",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    execute: async (input) => {
      const query = String(input.query ?? "").toLocaleLowerCase();
      const tasks = api.listTasks().filter((task) =>
        [task.title, task.label, task.status, task.assignee]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query),
      );
      return { count: tasks.length, tasks };
    },
  });
  Object.defineProperty(document, "modelContext", {
    value: context,
    configurable: true,
    writable: true,
  });
  return context;
}

export function registerNativeCreateTask(
  context: DemoModelContext,
  api: DemoWebMCPApi,
): void {
  context.registerTool({
    name: "create_task",
    description: "Create a task directly through the website's native WebMCP API",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        priority: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["title"],
    },
    execute: async (input) => ({ task: api.createTask(input), transport: "native-webmcp" }),
  });
}
