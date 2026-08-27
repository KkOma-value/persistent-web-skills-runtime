import { WebMCPDiscovery } from "./discovery";
import {
  isBridgeMessage,
  WEBMCP_BRIDGE_SOURCE,
  type WebMCPBridgeMessage,
} from "./protocol";

const discovery = new WebMCPDiscovery(document);

function post(message: WebMCPBridgeMessage): void {
  window.postMessage(message, "*");
}

async function publish(
  reason: "initial" | "toolchange" | "refresh",
): Promise<void> {
  const result = await discovery.discover();
  post({
    source: WEBMCP_BRIDGE_SOURCE,
    type: "webmcp:snapshot",
    available: result.available,
    tools: result.tools,
    error: result.error,
    reason,
  });
}

void publish("initial");
discovery.subscribe((result) => {
  post({
    source: WEBMCP_BRIDGE_SOURCE,
    type: "webmcp:snapshot",
    available: result.available,
    tools: result.tools,
    error: result.error,
    reason: "toolchange",
  });
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || !isBridgeMessage(event.data)) {
    return;
  }

  const message = event.data;
  if (message.type === "webmcp:refresh") {
    void publish("refresh");
    return;
  }

  if (message.type !== "webmcp:execute") {
    return;
  }

  void discovery
    .execute(message.toolName, message.input)
    .then((output) => {
      post({
        source: WEBMCP_BRIDGE_SOURCE,
        type: "webmcp:result",
        requestId: message.requestId,
        ok: true,
        output,
      });
    })
    .catch((error) => {
      post({
        source: WEBMCP_BRIDGE_SOURCE,
        type: "webmcp:result",
        requestId: message.requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
});
