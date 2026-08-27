import { useCallback, useEffect, useState } from "react";
import type { RuntimeSnapshot } from "../../shared/types";
import type { ExtensionMessage, ExtensionResponse } from "../messages";
import { ExecutionLog } from "./ExecutionLog";
import { SkillInspector } from "./SkillInspector";
import { ToolInspector } from "./ToolInspector";

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot>();
  const [tabId, setTabId] = useState<number>();
  const [error, setError] = useState<string>();

  const loadState = useCallback(async () => {
    const currentTabId = await activeTabId();
    if (currentTabId === undefined) {
      setError("No active browser tab");
      return;
    }
    setTabId(currentTabId);
    const response = (await chrome.runtime.sendMessage({
      type: "pws:get-tab-state",
      tabId: currentTabId,
    } satisfies ExtensionMessage)) as ExtensionResponse<RuntimeSnapshot>;
    if (!response.ok) {
      setError(response.error ?? "Unable to read runtime state");
      return;
    }
    setSnapshot(response.data);
    setError(undefined);
    return currentTabId;
  }, []);

  const refresh = useCallback(async () => {
    const currentTabId = await loadState();
    if (currentTabId === undefined) return;
    try {
      await chrome.tabs.sendMessage(currentTabId, { type: "pws:refresh" } satisfies ExtensionMessage);
    } catch {
      // Chrome internal pages do not host content scripts.
    }
  }, [loadState]);

  useEffect(() => {
    void refresh();
    const listener = (message: ExtensionMessage) => {
      if (message.type === "pws:state-updated" && message.tabId === tabId) {
        void loadState();
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [loadState, refresh, tabId]);

  return (
    <div className="sidepanel-shell">
      <header className="sidepanel-header">
        <div className="mini-mark"><span /><span /><span /></div>
        <div>
          <p>Persistent Web Skills</p>
          <h1>Runtime Inspector</h1>
        </div>
        <button onClick={() => void refresh()} aria-label="Refresh runtime state">↻</button>
      </header>
      <section className="current-page">
        <span className="online-dot" />
        <div>
          <small>Current website</small>
          <strong>{snapshot ? new URL(snapshot.url).hostname : "Waiting for page…"}</strong>
        </div>
      </section>
      {error && <div className="panel-notice">{error}</div>}
      {!snapshot && !error ? (
        <div className="panel-waiting">Open an http(s) page to start discovery.</div>
      ) : snapshot ? (
        <>
          <ToolInspector tools={snapshot.nativeTools} />
          <SkillInspector skills={snapshot.learnedSkills} />
          <ExecutionLog events={snapshot.events} />
        </>
      ) : null}
      <footer><span>Native</span><i>→</i><span>Memory</span><i>→</i><span>Learn</span></footer>
    </div>
  );
}
