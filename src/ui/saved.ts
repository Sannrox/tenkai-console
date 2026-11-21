import { create } from "zustand";

/**
 * Per-origin pin and recent lists in this browser. Name, type, and id only;
 * never tokens or server payloads. Blocked or corrupt storage reads as empty.
 */

const KINDS = ["environment", "product", "release", "runner", "plan", "finding"] as const;

export type ObjectKind = (typeof KINDS)[number];

export type SavedObject = {
  kind: ObjectKind;
  name: string;
  id: string;
};

const PIN_LIMIT = 20;
const RECENT_LIMIT = 10;
const KEY_PREFIX = "tenkai.saved:";

export const objectKey = (item: SavedObject): string => `${item.kind}:${item.id}`;

export const objectTypeLabel = (kind: ObjectKind): string =>
  kind === "environment" ? "env" : kind;

export const savedStorageKey = (): string => `${KEY_PREFIX}${window.location.origin}`;

const isKind = (value: unknown): value is ObjectKind =>
  typeof value === "string" && (KINDS as readonly string[]).includes(value);

const parseItem = (value: unknown): SavedObject | undefined => {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const rec = value as Record<string, unknown>;
  if (!isKind(rec.kind) || typeof rec.name !== "string" || typeof rec.id !== "string") {
    return undefined;
  }
  if (rec.name.length === 0 || rec.id.length === 0) {
    return undefined;
  }
  return { kind: rec.kind, name: rec.name, id: rec.id };
};

const parseList = (value: unknown): SavedObject[] =>
  Array.isArray(value) ? value.flatMap((item) => parseItem(item) ?? []) : [];

const empty = (): { pins: SavedObject[]; recent: SavedObject[] } => ({ pins: [], recent: [] });

const read = (): { pins: SavedObject[]; recent: SavedObject[] } => {
  try {
    const raw = globalThis.localStorage.getItem(savedStorageKey());
    if (!raw) {
      return empty();
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return empty();
    }
    const rec = parsed as Record<string, unknown>;
    return { pins: parseList(rec.pins), recent: parseList(rec.recent) };
  } catch {
    return empty();
  }
};

const write = (pins: SavedObject[], recent: SavedObject[]): boolean => {
  try {
    globalThis.localStorage.setItem(
      savedStorageKey(),
      JSON.stringify({
        pins: pins.map((item) => ({ kind: item.kind, name: item.name, id: item.id })),
        recent: recent.map((item) => ({ kind: item.kind, name: item.name, id: item.id })),
      }),
    );
    return true;
  } catch {
    return false;
  }
};

const moveToFront = (item: SavedObject, list: SavedObject[], limit: number): SavedObject[] =>
  [item, ...list.filter((entry) => objectKey(entry) !== objectKey(item))].slice(0, limit);

type SavedState = {
  pins: SavedObject[];
  recent: SavedObject[];
  togglePin: (item: SavedObject) => void;
  visit: (item: SavedObject) => void;
};

export const useSaved = create<SavedState>()((set, get) => ({
  ...read(),
  togglePin: (item) => {
    const key = objectKey(item);
    const current = get().pins;
    const pins = current.some((entry) => objectKey(entry) === key)
      ? current.filter((entry) => objectKey(entry) !== key)
      : moveToFront(item, current, PIN_LIMIT);
    const { recent } = get();
    if (!write(pins, recent)) {
      return;
    }
    set({ pins });
  },
  visit: (item) => {
    const current = get().recent[0];
    if (current && objectKey(current) === objectKey(item) && current.name === item.name) {
      return;
    }
    const recent = moveToFront(item, get().recent, RECENT_LIMIT);
    const { pins } = get();
    if (!write(pins, recent)) {
      return;
    }
    set({ recent });
  },
}));

/** Re-read storage into the store. Tests call this after clearing localStorage. */
export const reloadSaved = (): void => {
  useSaved.setState(read());
};
