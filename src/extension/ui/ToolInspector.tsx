import type { RuntimeTool } from "../../shared/types";

export interface ToolInspectorProps {
  tools: RuntimeTool[];
  available?: boolean;
}

export function ToolInspector({ tools, available = true }: ToolInspectorProps) {
  return (
    <section className="inspector-section" aria-labelledby="native-tools-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Priority 01</p>
          <h3 id="native-tools-heading">Native WebMCP</h3>
        </div>
        <span className={`count-pill ${available ? "is-online" : ""}`}>{tools.length}</span>
      </div>
      {!available ? (
        <div className="empty-state">API unavailable · graceful fallback active</div>
      ) : tools.length === 0 ? (
        <div className="empty-state">No native tools on this page</div>
      ) : (
        <div className="tool-list">
          {tools.map((tool) => (
            <article className="tool-row" key={tool.id}>
              <span className="source-dot source-dot-native" />
              <div>
                <code>{tool.name}()</code>
                <p>{tool.description ?? "Native page capability"}</p>
              </div>
              <span className="live-tag">LIVE</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
