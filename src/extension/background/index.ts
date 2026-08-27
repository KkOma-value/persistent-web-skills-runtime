import type { RuntimeSnapshot } from "../../shared/types";
import type { ExtensionMessage, ExtensionResponse } from "../messages";

const tabSnapshots = new Map<number, RuntimeSnapshot>();

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, sender, sendResponse: (response: ExtensionResponse) => void) => {
    if (message.type === "pws:runtime-snapshot") {
      const tabId = sender.tab?.id;
      if (tabId !== undefined) {
        tabSnapshots.set(tabId, message.snapshot);
        void chrome.runtime.sendMessage({ type: "pws:state-updated", tabId } satisfies ExtensionMessage);
      }
      sendResponse({ ok: true });
      return false;
    }

    if (message.type === "pws:get-tab-state") {
      sendResponse({ ok: true, data: tabSnapshots.get(message.tabId) });
      return false;
    }

    return false;
  },
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabSnapshots.delete(tabId);
});
