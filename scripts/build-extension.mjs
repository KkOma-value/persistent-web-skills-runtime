import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(projectRoot, "dist-extension");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const entries = [
  ["src/extension/content/webmcp/bridge-entry.ts", "content/webmcp-bridge.js"],
  ["src/extension/content/index.ts", "content/index.js"],
  ["src/extension/background/index.ts", "background/index.js"],
  ["src/extension/ui/main.tsx", "ui/index.js"],
];

for (const [entry, outfile] of entries) {
  await mkdir(dirname(resolve(outdir, outfile)), { recursive: true });
  await build({
    entryPoints: [resolve(projectRoot, entry)],
    outfile: resolve(outdir, outfile),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "chrome120",
    sourcemap: true,
    minify: false,
    jsx: "automatic",
  });
}

await cp(
  resolve(projectRoot, "src/extension/manifest.json"),
  resolve(outdir, "manifest.json"),
);
await cp(
  resolve(projectRoot, "src/extension/ui/inspector.html"),
  resolve(outdir, "inspector.html"),
);
