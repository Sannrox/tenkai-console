// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { objectKey, reloadSaved, savedStorageKey, useSaved } from "./saved";

const env = { kind: "environment" as const, name: "prod", id: "prod" };
const product = { kind: "product" as const, name: "api", id: "api" };

afterEach(() => {
  localStorage.clear();
  reloadSaved();
});

describe("saved objects", () => {
  it("pins survive a reload of the same origin and drop extra fields", () => {
    useSaved.getState().togglePin(env);
    const raw = localStorage.getItem(savedStorageKey());
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw ?? "")).toEqual({
      pins: [{ kind: "environment", name: "prod", id: "prod" }],
      recent: [],
    });
    expect(savedStorageKey()).toContain(window.location.origin);
    reloadSaved();
    expect(useSaved.getState().pins).toEqual([env]);
    useSaved.getState().togglePin(env);
    expect(useSaved.getState().pins).toEqual([]);
  });

  it("updates the name of the same recent object without a second slot", () => {
    useSaved.getState().visit({ kind: "plan", name: "prod", id: "prod" });
    useSaved.getState().visit({ kind: "plan", name: "api 1.0.0 to 1.1.0", id: "prod" });
    expect(useSaved.getState().recent).toHaveLength(1);
    expect(useSaved.getState().recent[0]?.name).toBe("api 1.0.0 to 1.1.0");
  });

  it("records recent visits newest first, unique, and capped", () => {
    for (let i = 0; i < 12; i += 1) {
      useSaved.getState().visit({ kind: "environment", name: `e${i}`, id: `e${i}` });
    }
    useSaved.getState().visit(env);
    useSaved.getState().visit(env);
    const { recent } = useSaved.getState();
    expect(recent[0]).toEqual(env);
    expect(recent.filter((item) => objectKey(item) === objectKey(env))).toHaveLength(1);
    expect(recent).toHaveLength(10);
  });

  it("ignores another origin's list and corrupt JSON", () => {
    localStorage.setItem(
      "tenkai.saved:http://other.example",
      JSON.stringify({ pins: [product], recent: [] }),
    );
    reloadSaved();
    expect(useSaved.getState().pins).toEqual([]);
    localStorage.setItem(savedStorageKey(), "{not json");
    reloadSaved();
    expect(useSaved.getState().pins).toEqual([]);
    localStorage.setItem(
      savedStorageKey(),
      JSON.stringify({
        pins: [
          { kind: "environment", name: "prod", id: "prod", token: "secret" },
          { kind: "nope" },
        ],
        recent: [{ kind: "product", name: "", id: "api" }],
      }),
    );
    reloadSaved();
    expect(useSaved.getState().pins).toEqual([env]);
    expect(useSaved.getState().recent).toEqual([]);
    expect(JSON.stringify(useSaved.getState().pins[0])).toBe(
      JSON.stringify({ kind: "environment", name: "prod", id: "prod" }),
    );
  });

  it("stays empty when storage throws, without writing a token", () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
    try {
      reloadSaved();
      useSaved.getState().togglePin(env);
      useSaved.getState().visit(product);
      expect(useSaved.getState().pins).toEqual([]);
      expect(useSaved.getState().recent).toEqual([]);
      expect(original.getItem(savedStorageKey())).toBeNull();
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});
