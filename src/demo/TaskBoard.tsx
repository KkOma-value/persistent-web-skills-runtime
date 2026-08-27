import type { DemoTask } from "./types";

interface TaskBoardProps {
  tasks: DemoTask[];
  broken: boolean;
  onCreate(task: Omit<DemoTask, "id" | "createdAt">): void;
}

function readTask(form: HTMLFormElement): Omit<DemoTask, "id" | "createdAt"> {
  const data = new FormData(form);
  return {
    title: String(data.get("title") ?? "Untitled task"),
    description: String(data.get("description") ?? ""),
    priority: String(data.get("priority") ?? "medium") as DemoTask["priority"],
    assignee: String(data.get("assignee") ?? "Ada"),
    project: String(data.get("project") ?? "Runtime"),
    status: String(data.get("status") ?? "todo") as DemoTask["status"],
    label: String(data.get("label") ?? "demo"),
    estimate: String(data.get("estimate") ?? "3"),
    dueDate: String(data.get("dueDate") ?? ""),
  };
}

export function TaskBoard({ tasks, broken, onCreate }: TaskBoardProps) {
  return (
    <main className="task-workspace">
      <div className="workspace-title-row">
        <div>
          <p className="eyebrow">Demo website · taskboard.local</p>
          <h2>Product sprint</h2>
        </div>
        <span className={`dom-version ${broken ? "is-broken" : ""}`}>
          DOM {broken ? "v2" : "v1"}
        </span>
      </div>

      <form
        className="task-form"
        aria-label="Task editor"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate(readTask(event.currentTarget));
          event.currentTarget.reset();
        }}
      >
        <div className="form-field form-field-wide">
          <label htmlFor="task-title">Task title</label>
          <input id="task-title" name="title" placeholder="What needs to happen?" required />
        </div>
        <div className="form-field form-field-wide">
          <label htmlFor="task-description">Description</label>
          <textarea id="task-description" name="description" rows={2} />
        </div>
        <div className="form-field">
          <label htmlFor="task-priority">Priority</label>
          <select id="task-priority" name="priority" defaultValue="medium">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="task-assignee">Assignee</label>
          <select id="task-assignee" name="assignee" defaultValue="Ada">
            <option>Ada</option>
            <option>Lin</option>
            <option>Grace</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="task-project">Project</label>
          <select id="task-project" name="project" defaultValue="Runtime">
            <option>Runtime</option>
            <option>Extension</option>
            <option>Demo</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="task-status">Status</label>
          <select id="task-status" name="status" defaultValue="todo">
            <option value="todo">To do</option>
            <option value="in-progress">In progress</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div className="form-field">
          <label htmlFor="task-label">Label</label>
          <input id="task-label" name="label" placeholder="runtime" />
        </div>
        <div className="form-field">
          <label htmlFor="task-estimate">Estimate</label>
          <input id="task-estimate" name="estimate" type="number" min="1" max="21" />
        </div>
        <div className="form-field">
          <label htmlFor="task-due">Due date</label>
          <input id="task-due" name="dueDate" type="date" />
        </div>
        <button className="create-button" type="submit">
          <span>{broken ? "Add Task" : "Create Task"}</span>
          <span aria-hidden="true">↗</span>
        </button>
      </form>

      <section className="task-list-section" aria-labelledby="task-list-heading">
        <div className="task-list-heading">
          <h3 id="task-list-heading">Sprint queue</h3>
          <span>{tasks.length} tasks</span>
        </div>
        {tasks.length === 0 ? (
          <div className="no-tasks">
            <span>◎</span>
            <p>The agent’s first task will appear here.</p>
          </div>
        ) : (
          <ul className="task-list">
            {tasks.map((task, index) => (
              <li aria-label={task.title} key={task.id}>
                <span className="task-index">{String(index + 1).padStart(2, "0")}</span>
                <div className="task-main-copy">
                  <strong>{task.title}</strong>
                  <p>{task.description || "No description"}</p>
                  <div className="task-tags">
                    <span>{task.project}</span>
                    <span>{task.label || "unlabelled"}</span>
                    <span>{task.estimate || "–"} pts</span>
                  </div>
                </div>
                <div className="task-side-copy">
                  <span className={`priority priority-${task.priority}`}>{task.priority}</span>
                  <small>{task.assignee}</small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
