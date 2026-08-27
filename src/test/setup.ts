import "fake-indexeddb/auto";

if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    value: {
      ...(globalThis.crypto ?? {}),
      randomUUID: () => `test-${Math.random().toString(16).slice(2)}`,
    },
  });
}
