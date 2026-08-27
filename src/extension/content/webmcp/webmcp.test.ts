import { describe, expect, it, vi } from "vitest";
import type { ModelContextLike, RegisteredWebMCPTool } from "../../../shared/types";
import { WebMCPDiscovery } from "./discovery";
import { diffNativeTools } from "./sync";

class FakeModelContext extends EventTarget implements ModelContextLike {
  tools: RegisteredWebMCPTool[] = [];
  async getTools() {
    return this.tools;
  }
}

describe("WebMCP discovery", () => {
  it("snapshots tools and rebinds the live handler for every execution", async () => {
    const context = new FakeModelContext();
    const first = vi.fn(async () => ({ version: 1 }));
    const second = vi.fn(async () => ({ version: 2 }));
    context.tools = [{ name: "checkout", description: "Checkout", execute: first }];
    const doc = document.implementation.createHTMLDocument("demo");
    Object.defineProperty(doc, "modelContext", { value: context });

    const discovery = new WebMCPDiscovery(doc);
    const snapshot = await discovery.discover();
    expect(snapshot.available).toBe(true);
    expect(snapshot.tools).toHaveLength(1);
    expect(snapshot.tools[0]).not.toHaveProperty("execute");

    context.tools = [{ name: "checkout", description: "Checkout v2", execute: second }];
    await expect(discovery.execute("checkout", { confirm: true })).resolves.toEqual({ version: 2 });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith({ confirm: true });
  });

  it("computes added, removed, and changed catalog entries after toolchange", async () => {
    const context = new FakeModelContext();
    context.tools = [
      { name: "search", description: "Search", execute: vi.fn() },
      { name: "add_to_cart", description: "Add", execute: vi.fn() },
    ];
    const doc = document.implementation.createHTMLDocument("demo");
    Object.defineProperty(doc, "modelContext", { value: context });
    const discovery = new WebMCPDiscovery(doc);
    const old = (await discovery.discover()).tools;
    context.tools = [
      { name: "search", description: "Search v2", execute: vi.fn() },
      { name: "checkout", description: "Checkout", execute: vi.fn() },
    ];
    const next = (await discovery.discover()).tools;
    const diff = diffNativeTools(old, next);
    expect(diff.added.map((tool) => tool.name)).toEqual(["checkout"]);
    expect(diff.removed.map((tool) => tool.name)).toEqual(["add_to_cart"]);
    expect(diff.changed.map((tool) => tool.name)).toEqual(["search"]);
  });

  it("gracefully falls back when modelContext is absent", async () => {
    const doc = document.implementation.createHTMLDocument("demo");
    await expect(new WebMCPDiscovery(doc).discover()).resolves.toEqual({
      available: false,
      tools: [],
    });
  });

  it("binds toolchange when a page exposes modelContext after document_start", async () => {
    vi.useFakeTimers();
    try {
      const doc = document.implementation.createHTMLDocument("late-demo");
      const context = new FakeModelContext();
      context.tools = [{ name: "late_tool", execute: vi.fn() }];
      const updates: string[] = [];
      const discovery = new WebMCPDiscovery(doc);
      const stop = discovery.subscribe((result) => {
        updates.push(...result.tools.map((tool) => tool.name));
      });
      Object.defineProperty(doc, "modelContext", { value: context });
      await vi.advanceTimersByTimeAsync(100);
      await Promise.resolve();
      expect(updates).toContain("late_tool");
      stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
