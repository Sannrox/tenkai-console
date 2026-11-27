import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SavedObject } from "../ui/saved";
import { parseReleaseSpec, releaseSpec } from "./objects";

/** Object names as links: same weight as surrounding text. */
export const objectLinkClass = "text-fg no-underline";

export const EnvironmentLink = ({ environment }: { environment: string }) => (
  <Link to="/environments/$environment" params={{ environment }} className={objectLinkClass}>
    {environment}
  </Link>
);

export const ProductLink = ({
  product,
  environment,
}: {
  product: string;
  environment?: string;
}) => (
  <Link
    to="/products/$product"
    params={{ product }}
    search={(prev: { environment?: string }) =>
      environment === undefined ? prev : { ...prev, environment }
    }
    className={objectLinkClass}
  >
    {product}
  </Link>
);

export const ReleaseLink = ({
  spec,
  environment,
  children,
}: {
  spec: string;
  environment?: string;
  children?: ReactNode;
}) => {
  const parsed = parseReleaseSpec(spec);
  const label = children ?? spec;
  if (parsed === undefined) {
    return <span className="font-mono">{label}</span>;
  }
  return (
    <Link
      to="/releases/$product/$version"
      params={parsed}
      search={(prev: { environment?: string }) =>
        environment === undefined ? prev : { ...prev, environment }
      }
      className={`font-mono ${objectLinkClass}`}
    >
      {label}
    </Link>
  );
};

export const RunnerLink = ({ id, label }: { id: string; label: string }) => (
  <Link
    to="/runners/$runnerId"
    params={{ runnerId: id }}
    className={`font-mono ${objectLinkClass}`}
  >
    {label}
  </Link>
);

export const PlanLink = ({
  environment,
  planId,
  children,
}: {
  environment: string;
  planId?: string;
  children: ReactNode;
}) =>
  planId === undefined ? (
    <Link to="/environments/$environment/plan" params={{ environment }} className={objectLinkClass}>
      {children}
    </Link>
  ) : (
    <Link
      to="/plans/$planId"
      params={{ planId }}
      search={{ environment }}
      className={objectLinkClass}
    >
      {children}
    </Link>
  );

export const FindingLink = ({
  advisory,
  release,
  component,
}: {
  advisory: string;
  release: string;
  component: string;
}) => (
  <Link
    to="/findings/$advisory"
    params={{ advisory }}
    search={{ release, component }}
    className={`font-mono ${objectLinkClass}`}
  >
    {advisory}
  </Link>
);

/** Environment, products, and target releases on a plan. */
export const planLinks = (
  environment: string,
  steps: ReadonlyArray<{ product: string; to: string }> | undefined,
) => {
  const list = steps ?? [];
  return [
    { key: "env", node: <EnvironmentLink environment={environment} /> },
    ...[...new Set(list.map((step) => step.product))].map((product) => ({
      key: `product:${product}`,
      node: <ProductLink product={product} environment={environment} />,
    })),
    ...list.map((step) => {
      const spec = releaseSpec(step.product, step.to);
      return { key: `rel:${spec}`, node: <ReleaseLink spec={spec} environment={environment} /> };
    }),
  ];
};

/** Pin and recent rows: same routes as the object pages. */
export const SavedLink = ({
  item,
  className = objectLinkClass,
}: {
  item: SavedObject;
  className?: string;
}) => {
  if (item.kind === "environment") {
    return (
      <Link to="/environments/$environment" params={{ environment: item.id }} className={className}>
        {item.name}
      </Link>
    );
  }
  if (item.kind === "product") {
    return (
      <Link to="/products/$product" params={{ product: item.id }} className={className}>
        {item.name}
      </Link>
    );
  }
  if (item.kind === "release") {
    const parsed = parseReleaseSpec(item.id) ?? parseReleaseSpec(item.name);
    if (parsed === undefined) {
      return <span className={className}>{item.name}</span>;
    }
    return (
      <Link to="/releases/$product/$version" params={parsed} className={`font-mono ${className}`}>
        {item.name}
      </Link>
    );
  }
  if (item.kind === "runner") {
    return (
      <Link
        to="/runners/$runnerId"
        params={{ runnerId: item.id }}
        className={`font-mono ${className}`}
      >
        {item.name}
      </Link>
    );
  }
  if (item.kind === "finding") {
    return (
      <Link
        to="/findings/$advisory"
        params={{ advisory: item.id }}
        className={`font-mono ${className}`}
      >
        {item.name}
      </Link>
    );
  }
  if (item.id.includes(":plan:")) {
    return (
      <Link to="/plans/$planId" params={{ planId: item.id }} className={className}>
        {item.name}
      </Link>
    );
  }
  return (
    <Link
      to="/environments/$environment/plan"
      params={{ environment: item.id }}
      className={className}
    >
      {item.name}
    </Link>
  );
};

export const matchesSaved = (path: string, item: SavedObject): boolean => {
  const restHas = (root: string, expected: string) => {
    const needle = `/${root}/`;
    const start = path.indexOf(needle);
    if (start < 0) {
      return false;
    }
    const rest = path.slice(start + needle.length);
    const encoded = encodeURIComponent(expected);
    return (
      rest === expected ||
      rest.startsWith(`${expected}/`) ||
      rest === encoded ||
      rest.startsWith(`${encoded}/`)
    );
  };
  if (item.kind === "environment") {
    return restHas("environments", item.id);
  }
  if (item.kind === "product") {
    return restHas("products", item.id);
  }
  if (item.kind === "release") {
    const parsed = parseReleaseSpec(item.id) ?? parseReleaseSpec(item.name);
    return parsed !== undefined && restHas("releases", `${parsed.product}/${parsed.version}`);
  }
  if (item.kind === "runner") {
    return restHas("runners", item.id);
  }
  if (item.kind === "finding") {
    return restHas("findings", item.id);
  }
  if (item.id.includes(":plan:")) {
    return restHas("plans", item.id);
  }
  return restHas("environments", item.id) && path.endsWith("/plan");
};

export const LinkedList = ({
  items,
}: {
  items: ReadonlyArray<{ key: string; node: ReactNode }>;
}) => (
  <div className="text-xs">
    <h2 className="mt-0 mb-2 text-[13px] font-semibold">Linked</h2>
    <ul className="m-0 list-none p-0">
      {items.length === 0 ? (
        <li className="text-muted">none</li>
      ) : (
        items.map((item) => (
          <li key={item.key} className="mb-1">
            {item.node}
          </li>
        ))
      )}
    </ul>
  </div>
);
