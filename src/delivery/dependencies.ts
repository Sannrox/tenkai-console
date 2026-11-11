import { type } from "arktype";
import { ApiError, request } from "../api/http";

// `GET /v1/environments/{environment}/dependencies` (Tenkai ADR 0043 / #1010).
// The pinned contract predates the route, so the response is validated here
// rather than trusted as a generated type.

const ImpactRefusal = type({
  dependent: "string",
  contract: "string",
});

const ProviderView = type({
  state: "'unique'",
  product: "string",
  release: "string",
  contract: "string",
  "instance?": "string",
})
  .or({ state: "'absent'" })
  .or({
    state: "'ambiguous'",
    products: "string[]",
  });

const RequirementView = type({
  contract: "string",
  minimum: "string",
  optional: "boolean",
  provider: ProviderView,
});

const ProductDependencyView = type({
  product: "string",
  "version?": "string",
  state: "string",
  requirements: RequirementView.array(),
  impact: {
    "remove?": ImpactRefusal,
    "upgrade?": ImpactRefusal,
    "rollback?": ImpactRefusal,
  },
});

const EnvironmentDependencies = type({
  environment: "string",
  holds: type({
    product: "string",
    release_id: "string",
    held_at: "number",
    contracts: type({
      contract: "string",
      minimum: "string",
      "candidates?": "string[]",
    }).array(),
  }).array(),
  products: ProductDependencyView.array(),
});

export type EnvironmentDependencies = typeof EnvironmentDependencies.infer;
export type ProductDependencyView = typeof ProductDependencyView.infer;
export type RequirementView = typeof RequirementView.infer;

export type DependenciesLoad =
  | { kind: "ok"; value: EnvironmentDependencies }
  | { kind: "unavailable" }
  | { kind: "forbidden" }
  | { kind: "error"; message: string };

/** Parse a recorded or live body; `undefined` when it is not this contract. */
export const parseDependencies = (raw: unknown): EnvironmentDependencies | undefined => {
  const value = EnvironmentDependencies(raw);
  return value instanceof type.errors ? undefined : value;
};

const visibleError = (error: ApiError): DependenciesLoad => {
  if (error.status === 404 || error.status === 405) {
    return { kind: "unavailable" };
  }
  if (error.status === 403) {
    return { kind: "forbidden" };
  }
  return {
    kind: "error",
    message: /HTTP \d{3}|\/v1\//.test(error.message) ? "Could not load" : error.message,
  };
};

/** Read the environment graph. Older servers have no route. */
export const fetchDependencies = async (
  environment: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<DependenciesLoad> => {
  let raw: unknown;
  try {
    raw = await request<unknown>(
      `v1/environments/${encodeURIComponent(environment)}/dependencies`,
      { token },
      fetcher,
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return visibleError(error);
    }
    return { kind: "error", message: "Could not load" };
  }
  const value = parseDependencies(raw);
  return value ? { kind: "ok", value } : { kind: "error", message: "Could not load" };
};

export const requirementLine = (requirement: RequirementView): string =>
  `${requirement.contract} >= ${requirement.minimum}${requirement.optional ? " optional" : ""}`;

const uniqueProviderName = (provider: {
  product: string;
  release: string;
  instance?: string;
}): string => {
  const instance = provider.instance?.trim() ?? "";
  if (instance === "" || instance === provider.product) {
    return `${provider.product}@${provider.release}`;
  }
  return `${instance} ${provider.product}@${provider.release}`;
};

export const providerLine = (requirement: RequirementView): string => {
  const { provider } = requirement;
  if (provider.state === "unique") {
    return uniqueProviderName(provider);
  }
  if (provider.state === "ambiguous") {
    return `unbound: ${provider.products.join(", ")}`;
  }
  return requirement.optional ? "absent" : "unmet";
};

export type DependencyHold = EnvironmentDependencies["holds"][number];
export type HoldContract = DependencyHold["contracts"][number];

/** Instant the API stored the hold, as ISO-8601. */
export const heldAt = (ms: number): string => new Date(ms).toISOString();

export const holdNeedLine = (contract: HoldContract): string =>
  `${contract.contract} >= ${contract.minimum}`;

/** Provider copy on the hold and the selected document. Graph cells keep `unmet`. */
export const holdProviderLine = (requirement: RequirementView): string => {
  const { provider } = requirement;
  if (provider.state === "unique") {
    return uniqueProviderName(provider);
  }
  if (provider.state === "ambiguous") {
    return `unbound: ${provider.products.join(", ")}`;
  }
  return requirement.optional ? "absent" : "no known provider";
};

const requirementFor = (
  hold: DependencyHold,
  products: ProductDependencyView[],
  contract: HoldContract,
): RequirementView | undefined =>
  products
    .find((item) => item.product === hold.product)
    ?.requirements.find((item) => item.contract === contract.contract);

/** Named provider for one hold contract, or `no known provider` when the graph is silent. */
export const holdContractProvider = (
  hold: DependencyHold,
  products: ProductDependencyView[],
  contract: HoldContract,
): string => {
  const requirement = requirementFor(hold, products, contract);
  return requirement ? holdProviderLine(requirement) : "no known provider";
};

export const holdContractTone = (
  hold: DependencyHold,
  products: ProductDependencyView[],
  contract: HoldContract,
): "ok" | "warn" | "bad" | "muted" | undefined => {
  const requirement = requirementFor(hold, products, contract);
  return requirement ? providerTone(requirement) : "bad";
};

export const waitingLine = (holds: DependencyHold[]): string =>
  holds
    .map((hold) => {
      const needs = hold.contracts.map(holdNeedLine).join(" · ");
      return needs ? `${hold.release_id}, ${needs}` : hold.release_id;
    })
    .join(" · ");

export const heldAtLine = (holds: DependencyHold[]): string =>
  [...new Set(holds.map((hold) => heldAt(hold.held_at)))].join(" · ");

export const heldProducts = (holds: DependencyHold[]): ReadonlySet<string> =>
  new Set(holds.map((hold) => hold.product));

/** Running release stays visible; `waiting` only when nothing is deployed yet. */
export const deployedLabel = (deployed: string | null | undefined, held: boolean): string => {
  if (held && (deployed === null || deployed === undefined || deployed === "")) {
    return "waiting";
  }
  return deployed ?? "none";
};

export const providerTone = (
  requirement: RequirementView,
): "ok" | "warn" | "bad" | "muted" | undefined => {
  if (requirement.provider.state === "unique") {
    return undefined;
  }
  if (requirement.provider.state === "ambiguous") {
    return "bad";
  }
  return requirement.optional ? "muted" : "bad";
};

export const stateTone = (state: string): "ok" | "warn" | "bad" | "muted" => {
  if (state === "current") {
    return "ok";
  }
  if (state === "waiting") {
    return "warn";
  }
  if (state === "unhealthy") {
    return "bad";
  }
  return "warn";
};

const names = (requirement: RequirementView): string[] => {
  if (requirement.provider.state === "unique") {
    const instance = requirement.provider.instance?.trim() ?? "";
    return [instance === "" ? requirement.provider.product : instance];
  }
  if (requirement.provider.state === "ambiguous") {
    return requirement.provider.products;
  }
  return [];
};

/** Products that name `product` as a unique or ambiguous provider. */
export const dependentsOf = (product: string, products: ProductDependencyView[]): string[] =>
  products
    .filter((candidate) =>
      candidate.requirements.some((requirement) => names(requirement).includes(product)),
    )
    .map((candidate) => candidate.product);

export const joinLines = (parts: string[]): string => parts.join(" · ") || "none";

export type DependencyRow = {
  product: string;
  release: string;
  state: string;
  stateTone: "ok" | "warn" | "bad" | "muted";
  requires: string;
  providedBy: string;
  providedTone: "bad" | "muted";
  dependents: string;
};

export const dependencyRows = (report: EnvironmentDependencies): DependencyRow[] =>
  report.products.map((product) => {
    const providedBy = joinLines(product.requirements.map(providerLine));
    return {
      product: product.product,
      release: product.version ?? "none",
      state: product.state,
      stateTone: stateTone(product.state),
      requires: joinLines(product.requirements.map(requirementLine)),
      providedBy,
      providedTone: product.requirements.some((requirement) => providerTone(requirement) === "bad")
        ? "bad"
        : "muted",
      dependents: joinLines(dependentsOf(product.product, report.products)),
    };
  });

export const impactLines = (product: ProductDependencyView): string[] => {
  const lines: string[] = [];
  const add = (action: string, refusal: { dependent: string; contract: string } | undefined) => {
    if (refusal) {
      lines.push(`${action} refused: ${refusal.dependent} requires ${refusal.contract}`);
    }
  };
  add("remove", product.impact.remove);
  add("upgrade", product.impact.upgrade);
  add("rollback", product.impact.rollback);
  return lines;
};
