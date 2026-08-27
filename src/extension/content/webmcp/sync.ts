import type { CatalogDiff, NativeToolSnapshot, RuntimeTool } from "../../../shared/types";

export function nativeSnapshotToRuntimeTool(snapshot: NativeToolSnapshot): RuntimeTool {
  return {
    id: snapshot.id,
    name: snapshot.name,
    description: snapshot.description,
    inputSchema: snapshot.inputSchema,
    source: "native-webmcp",
    origin: snapshot.origin,
    hash: snapshot.hash,
    lastSeen: snapshot.lastSeen,
  };
}

export function diffNativeTools(
  previous: NativeToolSnapshot[],
  next: NativeToolSnapshot[],
): CatalogDiff {
  const oldById = new Map(previous.map((tool) => [tool.id, tool]));
  const nextById = new Map(next.map((tool) => [tool.id, tool]));

  const added = next
    .filter((tool) => !oldById.has(tool.id))
    .map(nativeSnapshotToRuntimeTool);
  const removed = previous
    .filter((tool) => !nextById.has(tool.id))
    .map(nativeSnapshotToRuntimeTool);
  const changed = next
    .filter((tool) => {
      const old = oldById.get(tool.id);
      return old && old.hash !== tool.hash;
    })
    .map(nativeSnapshotToRuntimeTool);

  return { added, removed, changed };
}

export interface NativeToolSyncResult {
  tools: NativeToolSnapshot[];
  diff: CatalogDiff;
}

export function syncNativeTools(
  previous: NativeToolSnapshot[],
  next: NativeToolSnapshot[],
): NativeToolSyncResult {
  return { tools: next, diff: diffNativeTools(previous, next) };
}
