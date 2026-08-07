import "@testing-library/jest-dom";
import { beforeEach } from "vitest";

/**
 * A working `localStorage`.
 *
 * Every store persists through zustand, which reaches for the global
 * `localStorage` when the module is first imported. jsdom does not reliably
 * expose one here, and without it importing any store throws before a single
 * assertion runs — which is why component tests could not be written against
 * the stores until now.
 *
 * Cleared between tests so one test's saved state cannot leak into the next.
 */
class MemoryStorage implements Storage {
  private data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }
  clear(): void {
    this.data.clear();
  }
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

const storage = new MemoryStorage();

for (const target of [globalThis, globalThis.window].filter(Boolean)) {
  Object.defineProperty(target, "localStorage", { value: storage, writable: true, configurable: true });
  Object.defineProperty(target, "sessionStorage", { value: new MemoryStorage(), writable: true, configurable: true });
}

beforeEach(() => storage.clear());

/**
 * jsdom has no layout, so it implements no scrolling. Components that keep a
 * selected row in view call this and would otherwise throw during an effect —
 * a failure about the test environment rather than about the component.
 */
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
