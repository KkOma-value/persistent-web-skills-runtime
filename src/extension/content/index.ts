import type {
  BrowserLearningAgent,
  JsonObject,
  LearnResult,
  NativeToolSnapshot,
  RuntimeEvent,
  RuntimeSnapshot,
  WebSkill,
} from "../../shared/types";
import { SkillRegistry } from "../../storage/skill-registry";
import type { ExtensionMessage } from "../messages";
import {
  RuntimeOrchestrator,
  type NativeToolRuntime,
} from "./runtime/orchestrator";
import { RepairEngine } from "./runtime/repair-engine";
import { nativeSnapshotToRuntimeTool } from "./webmcp/sync";
import { WebMCPBridgeClient } from "./webmcp/client";
import type { DiscoveryResult } from "./webmcp/discovery";

const registry = new SkillRegistry();
const bridge = new WebMCPBridgeClient(window);
let nativeTools: NativeToolSnapshot[] = [];
let learnedSkills: WebSkill[] = [];
let events: RuntimeEvent[] = [];

class BridgeNativeToolRuntime implements NativeToolRuntime {
  private latest: DiscoveryResult = { available: false, tools: [] };
  private readonly listeners = new Set<(result: DiscoveryResult) => void>();

  constructor(private readonly bridge: WebMCPBridgeClient) {
    bridge.subscribe((tools, meta) => {
      this.latest = {
        available: meta.available,
        tools,
        error: meta.error,
      };
      for (const listener of this.listeners) listener(this.latest);
    });
  }

  async discover(): Promise<DiscoveryResult> {
    return new Promise((resolve) => {
      let settled = false;
      let timeout: number | undefined;
      const unsubscribe = this.bridge.subscribe((tools, meta) => {
        if (settled) return;
        settled = true;
        if (timeout !== undefined) window.clearTimeout(timeout);
        unsubscribe();
        resolve({ available: meta.available, tools, error: meta.error });
      });
      timeout = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(this.latest);
      }, 1_500);
      this.bridge.refresh();
    });
  }

  execute(toolName: string, input: JsonObject): Promise<unknown> {
    return this.bridge.execute(toolName, input);
  }

  subscribe(listener: (result: DiscoveryResult) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class HostBrowserLearningAgent implements BrowserLearningAgent {
  async learn(request: string, input: JsonObject): Promise<LearnResult> {
    const hostAgent = (window as Window & {
      __PWS_BROWSER_AGENT__?: (request: string, input: JsonObject) => Promise<LearnResult>;
    }).__PWS_BROWSER_AGENT__;
    if (!hostAgent) {
      throw new Error(
        "Browser learning agent is not configured; provide window.__PWS_BROWSER_AGENT__",
      );
    }
    return hostAgent(request, input);
  }
}

function addEvent(
  phase: RuntimeEvent["phase"],
  title: string,
  detail: string | undefined,
  status: RuntimeEvent["status"],
): void {
  events = [
    ...events.slice(-39),
    { id: crypto.randomUUID(), timestamp: Date.now(), phase, title, detail, status },
  ];
}

async function loadSkills(): Promise<void> {
  const hostname = location.hostname;
  learnedSkills = (await registry.list()).filter((skill) => skill.domain === hostname);
}

async function publish(): Promise<void> {
  await loadSkills();
  const snapshot: RuntimeSnapshot = {
    origin: location.origin,
    url: location.href,
    nativeTools: nativeTools.map(nativeSnapshotToRuntimeTool),
    learnedSkills,
    events,
    updatedAt: Date.now(),
  };
  const message: ExtensionMessage = { type: "pws:runtime-snapshot", snapshot };
  try {
    await chrome.runtime.sendMessage(message);
  } catch {
    // The extension may be reloaded while this isolated script is alive.
  }
}

bridge.subscribe((tools, meta) => {
  nativeTools = tools;
  void publish();
});

const nativeRuntime = new BridgeNativeToolRuntime(bridge);
const orchestrator = new RuntimeOrchestrator({
  registry,
  learningAgent: new HostBrowserLearningAgent(),
  nativeRuntime,
  repairEngine: new RepairEngine({
    endpoint:
      (window as Window & { __PWS_RUNTIME_API_URL__?: string }).__PWS_RUNTIME_API_URL__ ??
      "/api/repair-skill",
  }),
  onEvent: (event) => {
    addEvent(event.phase, event.title, event.detail, event.status);
    void publish();
  },
  onNativeSync: (tools) => {
    nativeTools = tools;
    void publish();
  },
  onSkillsChanged: (skills) => {
    learnedSkills = skills;
    void publish();
  },
});

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type === "pws:refresh") {
      void orchestrator
        .refreshNative("refresh")
        .then(() => publish())
        .then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "pws:execute-native") {
      void bridge
        .execute(message.toolName, message.input)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    }
    if (message.type === "pws:execute-task") {
      void orchestrator
        .executeTask(message.request, message.input ?? {}, { toolName: message.toolName })
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error) =>
          sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      return true;
    }
    return false;
  },
);

void orchestrator.initialize().catch((error) => {
  addEvent(
    "error",
    "Runtime initialization failed",
    error instanceof Error ? error.message : String(error),
    "error",
  );
  void publish();
});

window.addEventListener("pagehide", () => {
  bridge.destroy();
  registry.close();
});
