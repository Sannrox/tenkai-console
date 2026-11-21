import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
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
    search={environment === undefined ? {} : { environment }}
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
      search={environment === undefined ? {} : { environment }}
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
