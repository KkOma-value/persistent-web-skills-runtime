import type { JsonObject, RuntimeSnapshot } from "../shared/types";

export type ExtensionMessage =
  | { type: "pws:runtime-snapshot"; snapshot: RuntimeSnapshot }
  | { type: "pws:get-tab-state"; tabId: number }
  | { type: "pws:state-updated"; tabId: number }
  | { type: "pws:execute-native"; toolName: string; input: JsonObject }
  | { type: "pws:execute-task"; request: string; input?: JsonObject; toolName?: string }
  | { type: "pws:refresh" };

export interface ExtensionResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}
