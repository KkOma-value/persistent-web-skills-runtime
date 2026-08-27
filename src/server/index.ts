import express from "express";
import { config } from "dotenv";
import type { RepairContext, WebSkill } from "../shared/types";
import { AIService, patchSkillFromRepair } from "./ai";

config({ path: ".env.local" });
config();

const app = express();
const port = Number(process.env.PORT ?? 8787);
const ai = new AIService();

app.disable("x-powered-by");
app.use(express.json({ limit: "3mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, openaiConfigured: ai.configured, model: ai.model });
});

app.post("/api/agent", async (request, response) => {
  if (!ai.configured) {
    response.status(503).json({ ok: false, code: "OPENAI_NOT_CONFIGURED" });
    return;
  }
  try {
    const result = await ai.decide(String(request.body?.request ?? ""), request.body?.tools ?? []);
    response.json({ ok: true, decision: result });
  } catch (error) {
    response.status(502).json({ ok: false, code: "AGENT_MODEL_ERROR", error: safeError(error) });
  }
});

app.post("/api/generate-skill", async (request, response) => {
  if (!ai.configured) {
    response.status(503).json({ ok: false, code: "OPENAI_NOT_CONFIGURED" });
    return;
  }
  try {
    const result = await ai.generateSkill({
      userIntent: String(request.body?.userIntent ?? ""),
      actionTrace: request.body?.actionTrace ?? [],
      semanticDom: request.body?.semanticDom ?? {},
      validation: request.body?.validation ?? {},
    });
    response.json({ ok: true, skill: result });
  } catch (error) {
    response.status(502).json({ ok: false, code: "SKILL_MODEL_ERROR", error: safeError(error) });
  }
});

app.post("/api/repair-skill", async (request, response) => {
  if (!ai.configured) {
    response.status(503).json({ ok: false, code: "OPENAI_NOT_CONFIGURED" });
    return;
  }
  try {
    const context = request.body as RepairContext;
    const patch = await ai.repair(context);
    if (patch.stepIndex !== context.failedStepIndex) {
      response.status(422).json({ ok: false, code: "REPAIR_STEP_MISMATCH" });
      return;
    }
    const patchedSkill = patchSkillFromRepair(
      context.oldSkill,
      patch.stepIndex,
      patch.patchedLocator,
    );
    response.json({
      patchedSkill,
      changes: [
        {
          stepIndex: patch.stepIndex,
          before: context.oldSkill.workflow[patch.stepIndex]?.target,
          after: patch.patchedLocator,
        },
      ],
      reason: patch.reason,
      strategy: "server-model",
    });
  } catch (error) {
    response.status(502).json({ ok: false, code: "REPAIR_MODEL_ERROR", error: safeError(error) });
  }
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Persistent Web Skills API listening on http://127.0.0.1:${port}`);
});

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
