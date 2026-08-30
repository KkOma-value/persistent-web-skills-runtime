import type {
  JsonObject,
  ModelContextLike,
  RegisteredWebMCPTool,
} from "../shared/types";
import type { DemoTask } from "./types";

export class DemoModelContext extends EventTarget implements ModelContextLike {
  private readonly tools = new Map<string, RegisteredWebMCPTool>();
  private readonly registrationControllers = new Map<string, AbortController>();

  constructor(private readonly nativeContext?: ModelContextLike) {
    super();
  }

  async getTools(): Promise<RegisteredWebMCPTool[]> {
    if (this.nativeContext) return this.nativeContext.getTools();
    return [...this.tools.values()];
  }

  async registerTool(tool: RegisteredWebMCPTool): Promise<void> {
    this.registrationControllers.get(tool.name)?.abort();
    this.tools.set(tool.name, tool);
    if (this.nativeContext?.registerTool) {
      const controller = new AbortController();
      this.registrationControllers.set(tool.name, controller);
      await this.nativeContext.registerTool(tool, { signal: controller.signal });
    }
    this.dispatchEvent(new Event("toolchange"));
  }

  async unregisterTool(name: string): Promise<void> {
    const controller = this.registrationControllers.get(name);
    controller?.abort();
    this.registrationControllers.delete(name);
    if (!controller) await this.nativeContext?.unregisterTool?.(name);
    if (this.tools.delete(name)) {
      this.dispatchEvent(new Event("toolchange"));
    }
  }

  dispose(): void {
    for (const controller of this.registrationControllers.values()) {
      controller.abort();
    }
    this.registrationControllers.clear();
    this.tools.clear();
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }
}

export interface DemoWebMCPApi {
  listTasks: () => DemoTask[];
  createTask: (input: JsonObject) => DemoTask;
}

export function installDemoWebMCP(
  api: DemoWebMCPApi,
  doc: Document = document,
): DemoModelContext {
  const existingContext = doc.modelContext;
  const nativeContext =
    existingContext &&
    typeof existingContext.getTools === "function" &&
    typeof existingContext.registerTool === "function"
      ? existingContext
      : undefined;
  const context = new DemoModelContext(nativeContext);
  void context.registerTool({
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
  if (!nativeContext) {
    const descriptor = Object.getOwnPropertyDescriptor(doc, "modelContext");
    if (!descriptor || descriptor.configurable) {
      Object.defineProperty(doc, "modelContext", {
        value: context,
        configurable: true,
        writable: true,
      });
    }
  }
  return context;
}

export async function registerNativeCreateTask(
  context: DemoModelContext,
  api: DemoWebMCPApi,
): Promise<void> {
  await context.registerTool({
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
