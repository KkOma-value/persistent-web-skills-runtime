import type {
  AgentToolDecision,
  CatalogDiff,
  JsonObject,
  NativeToolSnapshot,
  RuntimeTool,
  WebSkill,
} from "../../../shared/types";
import { diffNativeTools, nativeSnapshotToRuntimeTool } from "../webmcp/sync";

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9\u4e00-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function toolScore(request: string, tool: RuntimeTool): number {
  const requestTokens = new Set(tokenize(request));
  const nameTokens = tokenize(tool.name);
  const descriptionTokens = tokenize(tool.description ?? "");
  let score = 0;

  for (const token of nameTokens) {
    if (requestTokens.has(token) || request.toLowerCase().includes(token)) {
      score += 3;
    }
  }
  for (const token of descriptionTokens) {
    if (requestTokens.has(token)) {
      score += 1;
    }
  }

  return score;
}

export class ToolCatalog {
  private nativeSnapshots: NativeToolSnapshot[] = [];
  private learnedTools: RuntimeTool[] = [];

  syncNative(snapshots: NativeToolSnapshot[]): CatalogDiff {
    const diff = diffNativeTools(this.nativeSnapshots, snapshots);
    this.nativeSnapshots = snapshots;
    return diff;
  }

  syncSkills(skills: WebSkill[]): void {
    this.learnedTools = skills.map((skill) => ({
      id: `skill:${skill.id}`,
      name: skill.name,
      description: skill.description,
      inputSchema: skill.inputSchema,
      source: "learned-skill",
      origin: skill.domain,
      skillId: skill.id,
      lastSeen: skill.lastVerifiedAt,
    }));
  }

  getNativeTools(): RuntimeTool[] {
    return this.nativeSnapshots.map(nativeSnapshotToRuntimeTool);
  }

  getLearnedTools(): RuntimeTool[] {
    return [...this.learnedTools];
  }

  getTools(): RuntimeTool[] {
    return [...this.getNativeTools(), ...this.getLearnedTools()];
  }

  resolve(name: string): RuntimeTool | undefined {
    // Native tools always win when the catalog exposes the same logical name.
    return (
      this.getNativeTools().find((tool) => tool.name === name) ??
      this.learnedTools.find((tool) => tool.name === name)
    );
  }

  decide(request: string, input: JsonObject = {}): AgentToolDecision {
    const ranked = this.getTools()
      .map((tool) => ({ tool, score: toolScore(request, tool) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        if (left.tool.source !== right.tool.source) {
          return left.tool.source === "native-webmcp" ? -1 : 1;
        }
        return left.tool.name.localeCompare(right.tool.name);
      });

    const best = ranked[0];
    if (!best) {
      return { input, confidence: 0 };
    }

    return {
      toolName: best.tool.name,
      input,
      confidence: Math.min(1, best.score / 9),
    };
  }
}
