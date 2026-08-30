import { stableHash } from "../../../shared/hash";
import type {
  JsonObject,
  ModelContextLike,
  NativeToolSnapshot,
  RegisteredWebMCPTool,
} from "../../../shared/types";

export interface DiscoveryResult {
  available: boolean;
  tools: NativeToolSnapshot[];
  error?: string;
}

function getOrigin(doc: Document): string {
  try {
    return doc.location.origin;
  } catch {
    return "unknown-origin";
  }
}

export function getModelContext(doc: Document = document): ModelContextLike | undefined {
  const context = doc.modelContext;
  if (!context || typeof context.getTools !== "function") {
    return undefined;
  }
  return context;
}

export function snapshotNativeTool(
  tool: RegisteredWebMCPTool,
  origin: string,
  lastSeen = Date.now(),
): NativeToolSnapshot {
  const data = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    origin,
  };

  return {
    id: `native:${origin}:${tool.name}`,
    ...data,
    hash: stableHash(data),
    lastSeen,
  };
}

export class WebMCPDiscovery {
  constructor(private readonly doc: Document = document) {}

  async discover(): Promise<DiscoveryResult> {
    const context = getModelContext(this.doc);
    if (!context) {
      return { available: false, tools: [] };
    }

    try {
      const registeredTools = await context.getTools();
      const origin = getOrigin(this.doc);
      const lastSeen = Date.now();
      const tools = registeredTools
        .filter((tool) => Boolean(tool?.name))
        .map((tool) => snapshotNativeTool(tool, origin, lastSeen));
      return { available: true, tools };
    } catch (error) {
      return {
        available: true,
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  subscribe(onChange: (result: DiscoveryResult) => void): () => void {
    let context = getModelContext(this.doc);
    const hadContextAtStart = Boolean(context);
    let timer: number | undefined;
    let attempts = 0;
    let attached = false;
    let stopped = false;
    let lastPollSignature: string | undefined;

    const handleToolChange = async () => {
      onChange(await this.discover());
    };
    const poll = async () => {
      if (stopped) return;
      const result = await this.discover();
      const signature = stableHash(
        result.tools.map(({ name, description, inputSchema, hash }) => ({
          name,
          description,
          inputSchema,
          hash,
        })),
      );
      if (lastPollSignature !== undefined && signature !== lastPollSignature) {
        onChange(result);
      }
      lastPollSignature = signature;
      timer = window.setTimeout(() => void poll(), 250);
    };
    const attach = () => {
      if (attached || stopped) return;
      context = getModelContext(this.doc);
      if (context) {
        attached = true;
        if (
          typeof context.addEventListener === "function" &&
          typeof context.removeEventListener === "function"
        ) {
          context.addEventListener("toolchange", handleToolChange);
          // A late modelContext should produce the same first snapshot as an early one.
          if (!hadContextAtStart) void this.discover().then(onChange);
        } else {
          // Some native browser implementations expose getTools/registerTool without
          // EventTarget methods. Polling a compact tool signature preserves live sync.
          void poll();
        }
        return;
      }
      if (attempts < 20) {
        attempts += 1;
        timer = window.setTimeout(attach, 100);
      }
    };
    attach();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      if (context && attached && typeof context.removeEventListener === "function") {
        context.removeEventListener("toolchange", handleToolChange);
      }
    };
  }

  async execute(toolName: string, input: JsonObject): Promise<unknown> {
    const context = getModelContext(this.doc);
    if (!context) {
      throw new Error("Native WebMCP is not available on the current page");
    }

    // RegisteredTool instances are intentionally rebound for every execution.
    const tools = await context.getTools();
    const currentTool = tools.find((tool) => tool.name === toolName);
    if (!currentTool) {
      throw new Error(`Native WebMCP tool \"${toolName}\" is no longer registered`);
    }

    const executor = currentTool.execute ?? currentTool.invoke ?? currentTool.handler;
    if (executor) {
      return executor.call(currentTool, input);
    }
    if (typeof context.executeTool === "function") {
      const nativeInput =
        typeof context.codexExecuteTool === "function"
          ? input
          : JSON.stringify(input);
      const result = await context.executeTool(currentTool, nativeInput);
      if (typeof result !== "string") return result;
      try {
        return JSON.parse(result) as unknown;
      } catch {
        return result;
      }
    }
    throw new Error(`Native WebMCP tool \"${toolName}\" has no executable handler`);
  }
}

export async function discoverWebMCP(doc: Document = document): Promise<DiscoveryResult> {
  return new WebMCPDiscovery(doc).discover();
}
