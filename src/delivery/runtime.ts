import type {
  EnvironmentRuntimeReport,
  ObservedInitJob,
  ObservedModelRuntime,
  ObservedRuntimeComponent,
  ObservedRuntimeUnit,
} from "../api/tenkai.gen";

/**
 * Observed runtime rows (GET `/v1/environments/{environment}/runtime`).
 * Labels and ordering only; every field is a server value.
 */

export type RuntimeRow = {
  product: string;
  executor: string;
  health: string;
  healthTone: "ok" | "warn" | "muted";
  units: string;
  init: string;
  model: string;
};

const healthTone = (health: string | undefined): RuntimeRow["healthTone"] => {
  if (!health) {
    return "muted";
  }
  return health === "healthy" ? "ok" : "warn";
};

/** One Docker unit: name, digest, running, health, restart policy. */
export const unitLine = (unit: ObservedRuntimeUnit): string =>
  [
    unit.name,
    unit.image_digest,
    unit.running ? "running" : "stopped",
    unit.health,
    unit.restart_policy,
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");

/** Last init job: name, status, exit code when the server sent one. */
export const initJobLine = (job: ObservedInitJob | undefined): string => {
  if (!job) {
    return "none";
  }
  return job.exit_code === undefined
    ? `${job.name} ${job.status}`
    : `${job.name} ${job.status} ${job.exit_code}`;
};

/** Model runtime: variant, accelerator fit when present, verified weight digest. */
export const modelLine = (model: ObservedModelRuntime | undefined): string => {
  if (!model) {
    return "none";
  }
  return [model.variant, model.accelerator, model.verified_weight_digest]
    .filter((part): part is string => Boolean(part))
    .join(" ");
};

const componentRow = (component: ObservedRuntimeComponent): RuntimeRow => ({
  product: component.product,
  executor: component.executor_kind,
  health: component.health ?? "none",
  healthTone: healthTone(component.health),
  units: (component.units ?? []).map(unitLine).join(" · ") || "none",
  init: initJobLine(component.last_init_job),
  model: modelLine(component.model_runtime),
});

export const runtimeRows = (report: EnvironmentRuntimeReport): RuntimeRow[] =>
  [...report.components]
    .toSorted((left, right) => left.product.localeCompare(right.product))
    .map(componentRow);
