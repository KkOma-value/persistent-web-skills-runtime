import type { JsonObject, NativeToolSnapshot } from "../../../shared/types";

export const WEBMCP_BRIDGE_SOURCE = "persistent-web-skills-runtime";

export type WebMCPBridgeMessage =
  | {
      source: typeof WEBMCP_BRIDGE_SOURCE;
      type: "webmcp:snapshot";
      available: boolean;
      tools: NativeToolSnapshot[];
      reason: "initial" | "toolchange" | "refresh";
      error?: string;
    }
  | {
      source: typeof WEBMCP_BRIDGE_SOURCE;
      type: "webmcp:execute";
      requestId: string;
      toolName: string;
      input: JsonObject;
    }
  | {
      source: typeof WEBMCP_BRIDGE_SOURCE;
      type: "webmcp:result";
      requestId: string;
      ok: boolean;
      output?: unknown;
      error?: string;
    }
  | {
      source: typeof WEBMCP_BRIDGE_SOURCE;
      type: "webmcp:refresh";
    };

export function isBridgeMessage(value: unknown): value is WebMCPBridgeMessage {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { source?: string }).source === WEBMCP_BRIDGE_SOURCE,
  );
}
