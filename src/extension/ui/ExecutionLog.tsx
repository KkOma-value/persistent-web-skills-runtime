import type { RuntimeEvent } from "../../shared/types";

export interface ExecutionLogProps {
  events: RuntimeEvent[];
}

const phaseLabels: Record<RuntimeEvent["phase"], string> = {
  discover: "DISCOVER",
  native: "NATIVE",
  memory: "MEMORY",
  validate: "VERIFY",
  execute: "EXECUTE",
  learn: "LEARN",
  repair: "REPAIR",
  complete: "DONE",
  error: "ERROR",
};

export function ExecutionLog({ events }: ExecutionLogProps) {
  const visible = events.slice(-12).reverse();
  return (
    <section className="inspector-section execution-section" aria-labelledby="execution-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Runtime stream</p>
          <h3 id="execution-heading">Execution</h3>
        </div>
        <span className="pulse-indicator" aria-label="Live" />
      </div>
      {visible.length === 0 ? (
        <div className="empty-state execution-empty">Run a task to watch routing decisions</div>
      ) : (
        <ol className="event-list">
          {visible.map((event) => (
            <li className={`event-row status-${event.status}`} key={event.id}>
              <div className="event-marker" />
              <div className="event-content">
                <div className="event-meta">
                  <span>{phaseLabels[event.phase]}</span>
                  <time>{new Date(event.timestamp).toLocaleTimeString([], { hour12: false })}</time>
                </div>
                <strong>{event.title}</strong>
                {event.detail && <p>{event.detail}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
