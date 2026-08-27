import type { JsonObject, NativeToolSnapshot } from "../../../shared/types";
import {
  isBridgeMessage,
  WEBMCP_BRIDGE_SOURCE,
  type WebMCPBridgeMessage,
} from "./protocol";

type SnapshotListener = (
  tools: NativeToolSnapshot[],
  meta: { available: boolean; reason: string; error?: string },
) => void;

export class WebMCPBridgeClient {
  private readonly snapshotListeners = new Set<SnapshotListener>();
  private readonly pending = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void; timeout: number }
  >();

  constructor(private readonly hostWindow: Window = window) {
    this.hostWindow.addEventListener("message", this.handleMessage);
  }

  subscribe(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  refresh(): void {
    this.post({ source: WEBMCP_BRIDGE_SOURCE, type: "webmcp:refresh" });
  }

  execute(toolName: string, input: JsonObject, timeoutMs = 15_000): Promise<unknown> {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Native WebMCP tool \"${toolName}\" timed out`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timeout });
      this.post({
        source: WEBMCP_BRIDGE_SOURCE,
        type: "webmcp:execute",
        requestId,
        toolName,
        input,
      });
    });
  }

  destroy(): void {
    this.hostWindow.removeEventListener("message", this.handleMessage);
    for (const pending of this.pending.values()) {
      window.clearTimeout(pending.timeout);
      pending.reject(new Error("WebMCP bridge client was destroyed"));
    }
    this.pending.clear();
    this.snapshotListeners.clear();
  }

  private post(message: WebMCPBridgeMessage): void {
    this.hostWindow.postMessage(message, "*");
  }

  private readonly handleMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.hostWindow || !isBridgeMessage(event.data)) {
      return;
    }

    const message = event.data;
    if (message.type === "webmcp:snapshot") {
      for (const listener of this.snapshotListeners) {
        listener(message.tools, {
          available: message.available,
          reason: message.reason,
          error: message.error,
        });
      }
      return;
    }

    if (message.type !== "webmcp:result") {
      return;
    }

    const pending = this.pending.get(message.requestId);
    if (!pending) {
      return;
    }

    window.clearTimeout(pending.timeout);
    this.pending.delete(message.requestId);
    if (message.ok) {
      pending.resolve(message.output);
    } else {
      pending.reject(new Error(message.error ?? "Native WebMCP execution failed"));
    }
  };
}
