import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  JsonObject,
  RuntimeEvent,
  RuntimeTaskResult,
  RuntimeTool,
  WebSkill,
} from "../shared/types";
import { SkillRegistry } from "../storage/skill-registry";
import { RuntimeOrchestrator } from "../extension/content/runtime/orchestrator";
import { RepairEngine } from "../extension/content/runtime/repair-engine";
import { nativeSnapshotToRuntimeTool } from "../extension/content/webmcp/sync";
import { ExecutionLog } from "../extension/ui/ExecutionLog";
import { SkillInspector } from "../extension/ui/SkillInspector";
import { ToolInspector } from "../extension/ui/ToolInspector";
import { DemoLearningAgent } from "./demo-learning-agent";
import {
  installDemoWebMCP,
  registerNativeCreateTask,
  type DemoModelContext,
} from "./mock-webmcp";
import { TaskBoard } from "./TaskBoard";
import type { DemoTask } from "./types";

interface RunRecord {
  id: string;
  route: RuntimeTaskResult["route"];
  durationMs: number;
  title: string;
}

const demoInputs = [
  { title: "Login bug", description: "Reproduce and fix the expired session redirect" },
  { title: "Checkout regression", description: "Verify cart totals after applying a coupon" },
  { title: "Mobile navigation", description: "Repair the compact menu focus order" },
  { title: "Runtime telemetry", description: "Add timing spans for skill execution" },
];

function taskInput(title: string, description: string): JsonObject {
  return {
    title,
    description,
    priority: "high",
    assignee: "Ada",
    project: "Runtime",
    status: "todo",
    label: "agent-demo",
    estimate: "5",
    dueDate: "2026-09-18",
  };
}

function titleFromRequest(request: string, fallback: string): string {
  const quoted = request.match(/["“]([^"”]+)["”]/)?.[1];
  if (quoted) return quoted;
  const afterColon = request.split(/[:：]/).slice(1).join(":").trim();
  return afterColon || fallback;
}

function phaseStatus(
  records: RunRecord[],
  route: RuntimeTaskResult["route"],
): RunRecord | undefined {
  return records.find((record) => record.route === route);
}

function formatDuration(duration: number): string {
  return duration >= 1_000 ? `${(duration / 1_000).toFixed(2)}s` : `${Math.max(1, Math.round(duration))}ms`;
}

export function App() {
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const tasksRef = useRef<DemoTask[]>([]);
  const [nativeTools, setNativeTools] = useState<RuntimeTool[]>([]);
  const [skills, setSkills] = useState<WebSkill[]>([]);
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [runRecords, setRunRecords] = useState<RunRecord[]>([]);
  const [request, setRequest] = useState('Create a task: "Login bug"');
  const [broken, setBroken] = useState(false);
  const [running, setRunning] = useState(false);
  const [guided, setGuided] = useState(false);
  const [nativeCreateRegistered, setNativeCreateRegistered] = useState(false);
  const [lastOutput, setLastOutput] = useState<unknown>();
  const [initializationError, setInitializationError] = useState<string>();
  const registryRef = useRef(new SkillRegistry("persistent-web-skills-demo-v1"));
  const orchestratorRef = useRef<RuntimeOrchestrator | undefined>(undefined);
  const modelContextRef = useRef<DemoModelContext | undefined>(undefined);
  const nextInputIndex = useRef(0);

  const createTask = useCallback((input: JsonObject): DemoTask => {
    const priorityValue = String(input.priority ?? "medium");
    const statusValue = String(input.status ?? "todo");
    const task: DemoTask = {
      id: crypto.randomUUID(),
      title: String(input.title ?? "Untitled task"),
      description: String(input.description ?? ""),
      priority: ["low", "medium", "high"].includes(priorityValue)
        ? (priorityValue as DemoTask["priority"])
        : "medium",
      assignee: String(input.assignee ?? "Ada"),
      project: String(input.project ?? "Runtime"),
      status: ["todo", "in-progress", "blocked"].includes(statusValue)
        ? (statusValue as DemoTask["status"])
        : "todo",
      label: String(input.label ?? "demo"),
      estimate: String(input.estimate ?? "3"),
      dueDate: String(input.dueDate ?? ""),
      createdAt: Date.now(),
    };
    tasksRef.current = [task, ...tasksRef.current];
    setTasks(tasksRef.current);
    return task;
  }, []);

  useEffect(() => {
    const api = {
      listTasks: () => tasksRef.current,
      createTask,
    };
    const modelContext = installDemoWebMCP(api);
    modelContextRef.current = modelContext;
    const orchestrator = new RuntimeOrchestrator({
      registry: registryRef.current,
      learningAgent: new DemoLearningAgent(document),
      document,
      repairEngine: new RepairEngine({ endpoint: "/api/repair-skill" }),
      onEvent: (event) => setEvents((current) => [...current.slice(-79), event]),
      onNativeSync: (snapshots) =>
        setNativeTools(snapshots.map(nativeSnapshotToRuntimeTool)),
      onSkillsChanged: setSkills,
    });
    orchestratorRef.current = orchestrator;
    void orchestrator.initialize().catch((error) => {
      setInitializationError(error instanceof Error ? error.message : String(error));
    });

    return () => {
      orchestrator.destroy();
      registryRef.current.close();
    };
  }, [createTask]);

  const executeCreate = useCallback(async (title: string, description: string) => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator) throw new Error("Runtime is still initializing");
    const result = await orchestrator.executeTask(
      `Create task \"${title}\"`,
      taskInput(title, description),
      { toolName: "create_task" },
    );
    setRunRecords((current) => [
      ...current,
      { id: crypto.randomUUID(), route: result.route, durationMs: result.durationMs, title },
    ]);
    setLastOutput(result.output);
    return result;
  }, []);

  const runRequest = async () => {
    if (running) return;
    setRunning(true);
    try {
      const preset = demoInputs[nextInputIndex.current % demoInputs.length];
      const title = titleFromRequest(request, preset.title);
      await executeCreate(title, preset.description);
      nextInputIndex.current += 1;
      const next = demoInputs[nextInputIndex.current % demoInputs.length];
      setRequest(`Create a task: \"${next.title}\"`);
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const resetDemo = useCallback(async () => {
    await registryRef.current.clear();
    await orchestratorRef.current?.refreshSkills();
    modelContextRef.current?.unregisterTool("create_task");
    setNativeCreateRegistered(false);
    tasksRef.current = [];
    setTasks([]);
    setEvents([]);
    setRunRecords([]);
    setLastOutput(undefined);
    setBroken(false);
    setInitializationError(undefined);
    nextInputIndex.current = 0;
    setRequest('Create a task: "Login bug"');
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }, []);

  const runGuidedDemo = async () => {
    if (running || guided) return;
    setGuided(true);
    setRunning(true);
    try {
      await resetDemo();
      await executeCreate(demoInputs[0].title, demoInputs[0].description);
      await executeCreate(demoInputs[1].title, demoInputs[1].description);
      setBroken(true);
      await new Promise((resolve) => window.setTimeout(resolve, 100));
      await executeCreate(demoInputs[2].title, demoInputs[2].description);
      setRequest(`Create a task: \"${demoInputs[3].title}\"`);
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
      setGuided(false);
    }
  };

  const runNativeSearch = async () => {
    const orchestrator = orchestratorRef.current;
    if (!orchestrator || running) return;
    setRunning(true);
    try {
      const result = await orchestrator.executeTask(
        "Search tasks agent-demo",
        { query: "agent-demo" },
        { toolName: "search_tasks" },
      );
      setLastOutput(result.output);
      setRunRecords((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          route: result.route,
          durationMs: result.durationMs,
          title: "search_tasks",
        },
      ]);
    } catch (error) {
      setInitializationError(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  const registerNativeCreate = () => {
    const context = modelContextRef.current;
    if (!context || context.has("create_task")) return;
    registerNativeCreateTask(context, {
      listTasks: () => tasksRef.current,
      createTask,
    });
    setNativeCreateRegistered(true);
  };

  const learnRecord = phaseStatus(runRecords, "learned-skill");
  const reuseRecord = phaseStatus(runRecords, "cached-skill");
  const repairRecord = phaseStatus(runRecords, "repaired-skill");
  const lastRecord = runRecords.at(-1);
  const runLabel = useMemo(() => {
    if (guided) return "Running Learn → Reuse → Repair…";
    if (running) return "Runtime working…";
    return "Run task";
  }, [guided, running]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div>
            <strong>Persistent Web Skills</strong>
            <span>Runtime / MVP</span>
          </div>
        </div>
        <div className="priority-ribbon" aria-label="Execution priority">
          <span>Native</span><i>→</i><span>Memory</span><i>→</i><span>Learn</span>
        </div>
        <div className="runtime-health"><span /> Runtime online</div>
      </header>

      <section className="hero-strip">
        <div>
          <p className="eyebrow">Agents shouldn’t relearn the web every time.</p>
          <h1>Learn once. Reuse.<br /><em>Self-repair.</em></h1>
        </div>
        <p className="hero-copy">
          A durable execution layer that discovers native page tools, remembers successful
          workflows, and patches only what changed.
        </p>
      </section>

      <section className="demo-controls" aria-label="Demo controls">
        <div className="command-box">
          <span className="command-prefix">USER</span>
          <input
            aria-label="Natural language task"
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runRequest();
            }}
          />
          <button onClick={() => void runRequest()} disabled={running}>{runLabel}<span>↵</span></button>
        </div>
        <div className="secondary-controls">
          <button className="guided-button" onClick={() => void runGuidedDemo()} disabled={running}>
            <span>▶</span> Run 90-sec demo
          </button>
          <button onClick={() => setBroken(true)} disabled={broken || running}>Break DOM</button>
          <button onClick={registerNativeCreate} disabled={nativeCreateRegistered}>+ Native create_task</button>
          <button onClick={() => void runNativeSearch()} disabled={running}>Test native search</button>
          <button onClick={() => void resetDemo()} disabled={running}>Reset</button>
        </div>
      </section>

      {initializationError && (
        <div className="error-banner"><strong>Runtime notice</strong><span>{initializationError}</span></div>
      )}

      <section className="phase-grid" aria-label="Demo phases">
        <article className={learnRecord ? "phase-card is-complete" : "phase-card"}>
          <span className="phase-number">01</span>
          <div><p>LEARN</p><strong>Observe & abstract</strong><small>11 semantic browser actions</small></div>
          <b>{learnRecord ? formatDuration(learnRecord.durationMs) : "WAITING"}</b>
        </article>
        <article className={reuseRecord ? "phase-card is-complete" : "phase-card"}>
          <span className="phase-number">02</span>
          <div><p>REUSE</p><strong>Memory hit</strong><small>Fingerprint → execute → validate</small></div>
          <b>{reuseRecord ? formatDuration(reuseRecord.durationMs) : "WAITING"}</b>
        </article>
        <article className={repairRecord ? "phase-card is-complete repair-complete" : "phase-card"}>
          <span className="phase-number">03</span>
          <div><p>REPAIR</p><strong>Patch the failed step</strong><small>v1 → v2 · validated</small></div>
          <b>{repairRecord ? formatDuration(repairRecord.durationMs) : broken ? "DRIFTED" : "WAITING"}</b>
        </article>
      </section>

      {lastRecord && (
        <div className={`result-ribbon route-${lastRecord.route}`}>
          <span>{lastRecord.route.replaceAll("-", " ")}</span>
          <strong>{lastRecord.title}</strong>
          <small>{formatDuration(lastRecord.durationMs)}</small>
        </div>
      )}

      <div className="main-grid">
        <TaskBoard
          tasks={tasks}
          broken={broken}
          onCreate={(task) => createTask(task as unknown as JsonObject)}
        />
        <aside className="runtime-inspector">
          <div className="inspector-header">
            <div>
              <p className="eyebrow">Runtime inspector</p>
              <h2>Live capability graph</h2>
            </div>
            <div className="website-chip"><span /> taskboard.local</div>
          </div>
          <ToolInspector tools={nativeTools} available />
          <SkillInspector skills={skills} />
          <ExecutionLog events={events} />
          {lastOutput !== undefined && (
            <section className="output-panel">
              <p className="eyebrow">Latest native output</p>
              <pre>{JSON.stringify(lastOutput, null, 2)}</pre>
            </section>
          )}
        </aside>
      </div>

      <footer>
        <span>Persistent Web Skills Runtime</span>
        <span>Native WebMCP · IndexedDB memory · semantic repair</span>
      </footer>
    </div>
  );
}
