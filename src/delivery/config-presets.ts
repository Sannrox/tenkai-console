import { type } from "arktype";

// Where a plan says each product's config comes from (#1095). The generated
// type already has `config_presets`; this parse still drops a malformed row
// so an older or partial body cannot blank the rest of the page.
//
// Reuse decision
// Job: show which source supplied each config key, and on an upgrade plan
// show per-key conflicts without applying a rebase.
// Verdict: Reuse
// Concept: extra plan fields as in `artifact-availability.ts`; overlay table
// source column as in `config-schema.ts`; Card region as Artifacts.
// Edge: no overlay or preset HTTP route; pin stays; rebase is display only.
// Searched: inspect.config.preset (absent), overlay HTTP (none), rebase HTTP
// (none), latest_plan.config_presets (present). Rejected: pin bump; preset
// editor; client-side drop commands.

const View = type({
  product: "string",
  preset: "string",
  "from_preset?": "string[]",
  "overridden?": "string[]",
  "conflicts?": "string[]",
  "+": "delete",
});

export const PRESET_COPY = {
  none: "No presets on this plan",
  unchanged: "Nothing is changed without a plan",
  fromPreset: "from preset",
  overridden: "overridden",
  conflict: "conflict",
} as const;

export type ConfigConflict = {
  key: string;
  text: string;
};

export type ConfigPresetRow = {
  product: string;
  preset: string;
  fromPreset: string[];
  overridden: string[];
  conflicts: ConfigConflict[];
};

const keys = (values: string[] | undefined): string[] =>
  [
    ...new Set((values ?? []).map((value) => value.trim()).filter((value) => value !== "")),
  ].toSorted();

/** Operator-facing conflict: the server line, keyed by the overlay it names. */
export const parseConflict = (line: string): ConfigConflict | undefined => {
  const text = line.trim();
  const key = text.split(":")[0]?.trim() ?? "";
  if (key === "") {
    return undefined;
  }
  return { key, text };
};

const byProduct = (left: ConfigPresetRow, right: ConfigPresetRow) =>
  left.product.localeCompare(right.product);

/** Preset sources and conflicts on one plan. Malformed rows are dropped. */
export const parseConfigPresets = (plan: unknown): ConfigPresetRow[] => {
  if (typeof plan !== "object" || plan === null || !("config_presets" in plan)) {
    return [];
  }
  const raw = plan.config_presets;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .flatMap((item) => {
      const value = View(item);
      if (value instanceof type.errors) {
        return [];
      }
      const preset = value.preset.trim();
      const product = value.product.trim();
      if (product === "" || preset === "") {
        return [];
      }
      return [
        {
          product,
          preset,
          fromPreset: keys(value.from_preset),
          overridden: keys(value.overridden),
          conflicts: (value.conflicts ?? []).flatMap((line) => {
            const conflict = parseConflict(line);
            return conflict === undefined ? [] : [conflict];
          }),
        } satisfies ConfigPresetRow,
      ];
    })
    .toSorted(byProduct);
};

/** Preset sources on inspect's latest plan, if the server sent them. */
export const inspectPresets = (report: unknown): ConfigPresetRow[] => {
  if (typeof report !== "object" || report === null || !("latest_plan" in report)) {
    return [];
  }
  return parseConfigPresets(report.latest_plan);
};

export const hasConflicts = (rows: readonly ConfigPresetRow[]): boolean =>
  rows.some((row) => row.conflicts.length > 0);
