import { useState } from "react";
import {
  type EnvironmentDependencies as DependenciesReport,
  type ProductDependencyView,
  dependencyRows,
  heldAt,
  holdContractProvider,
  holdContractTone,
  holdNeedLine,
  holdProviderLine,
  impactLines,
  providerTone,
} from "../delivery/dependencies";
import {
  type BindingRow,
  type GrantRow,
  bindingRows,
  grantRows,
  healthByInstance,
  type InstanceSubscription,
} from "../delivery/instances";
import { useEnvironmentDependencies } from "../delivery/use-delivery";
import { Card } from "../ui/kit";

const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";
const TONE = {
  ok: "text-ok",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted",
} as const;

const COPY = {
  unavailable: "This server does not report product dependencies.",
  forbidden: "No access",
  empty: "none",
  loading: "Loading",
} as const;

const NO_SUBSCRIPTIONS: InstanceSubscription[] = [];

/**
 * Plan-order requires table for the selected environment.
 * GET `/v1/environments/{environment}/dependencies`.
 */
export const EnvironmentDependencies = ({
  environment,
  token,
  subscriptions = NO_SUBSCRIPTIONS,
}: {
  environment: string;
  token: string;
  subscriptions?: InstanceSubscription[];
}) => {
  const query = useEnvironmentDependencies(token, environment);
  const load = query.data;
  const waiting = load?.kind === "ok" ? load.value.holds.length : 0;
  const health = healthByInstance(subscriptions);
  const bindings = load?.kind === "ok" ? bindingRows(load.value, health) : [];
  const grants = load?.kind === "ok" ? grantRows(load.value) : [];
  const body =
    query.isPending || load === undefined ? (
      <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.loading}</p>
    ) : load.kind === "unavailable" ? (
      <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.unavailable}</p>
    ) : load.kind === "forbidden" ? (
      <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.forbidden}</p>
    ) : load.kind === "error" ? (
      <p role="alert" className="m-0 px-3.5 py-3 text-xs text-danger">
        {load.message}
      </p>
    ) : load.value.products.length === 0 && load.value.holds.length === 0 ? (
      <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>
    ) : null;

  return (
    <>
      <div className="mt-[18px] mb-2 flex items-baseline gap-2">
        <h2 className="m-0 text-[13px] font-semibold">Dependencies</h2>
        {waiting > 0 && (
          <span className="text-[13px] font-medium text-muted">{waiting} waiting</span>
        )}
      </div>
      {body ? (
        <Card className="overflow-x-auto">{body}</Card>
      ) : load?.kind === "ok" ? (
        <>
          {load.value.holds.length > 0 && <Holds report={load.value} />}
          {load.value.products.length > 0 && (
            <Card className="overflow-x-auto">
              <Graph report={load.value} />
            </Card>
          )}
          {bindings.length > 0 && <Bindings rows={bindings} />}
          {bindings.length > 0 && <Grants rows={grants} />}
        </>
      ) : null}
    </>
  );
};

const Holds = ({ report }: { report: DependenciesReport }) => (
  <Card className="mb-3 overflow-x-auto">
    {report.holds.map((hold) => (
      <div
        key={`${hold.product}:${hold.release_id}:${hold.held_at}`}
        className="border-b border-line px-3.5 py-3 last:border-b-0"
      >
        <div className="mb-1 font-mono text-[13px] font-semibold">{hold.release_id}</div>
        <p className="mt-0 mb-2 text-xs text-muted">{`held at ${heldAt(hold.held_at)}`}</p>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Need</th>
              <th className={th}>Provider</th>
            </tr>
          </thead>
          <tbody>
            {hold.contracts.map((contract) => {
              const tone = holdContractTone(hold, report.products, contract);
              return (
                <tr key={contract.contract} className="[&:last-child>td]:border-b-0">
                  <td className={`${td} font-mono`}>{holdNeedLine(contract)}</td>
                  <td className={`${td} font-mono ${tone ? TONE[tone] : ""}`}>
                    {holdContractProvider(hold, report.products, contract)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    ))}
  </Card>
);

const Graph = ({ report }: { report: DependenciesReport }) => {
  const rows = dependencyRows(report);
  const initial = rows.find((row) => row.state === "waiting")?.product ?? rows[0]?.product;
  const [selected, setSelected] = useState(initial);
  const product = report.products.find((item) => item.product === selected);

  return (
    <>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>Product</th>
            <th className={th}>Release</th>
            <th className={th}>State</th>
            <th className={th}>Requires</th>
            <th className={th}>Provided by</th>
            <th className={th}>Dependents</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.product}
              aria-selected={row.product === selected}
              onClick={() => setSelected(row.product)}
              className={`cursor-pointer [&:last-child>td]:border-b-0 ${row.product === selected ? "bg-selected" : ""}`}
            >
              <td className={`${td} font-mono`}>{row.product}</td>
              <td className={`${td} font-mono ${row.release === "none" ? "text-muted" : ""}`}>
                {row.release}
              </td>
              <td className={`${td} ${TONE[row.stateTone]}`}>{row.state}</td>
              <td className={`${td} font-mono ${row.requires === "none" ? "text-muted" : ""}`}>
                {row.requires}
              </td>
              <td
                className={`${td} font-mono ${row.providedBy === "none" || row.providedTone === "bad" ? TONE[row.providedTone] : ""}`}
              >
                {row.providedBy}
              </td>
              <td className={`${td} font-mono ${row.dependents === "none" ? "text-muted" : ""}`}>
                {row.dependents}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {product && <Document product={product} />}
    </>
  );
};

const Document = ({ product }: { product: ProductDependencyView }) => {
  const impact = impactLines(product);
  return (
    <div className="border-t border-line px-3.5 py-3">
      <div className="mb-2 font-mono text-[13px] font-semibold">{product.product}</div>
      {product.requirements.length === 0 ? (
        <p className="m-0 text-xs text-muted">none</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Contract</th>
              <th className={th}>Need</th>
              <th className={th}>Provider</th>
            </tr>
          </thead>
          <tbody>
            {product.requirements.map((requirement) => {
              const tone = providerTone(requirement);
              return (
                <tr key={requirement.contract} className="[&:last-child>td]:border-b-0">
                  <td className={`${td} font-mono`}>{requirement.contract}</td>
                  <td className={`${td} font-mono`}>
                    {`>= ${requirement.minimum}${requirement.optional ? " optional" : ""}`}
                  </td>
                  <td className={`${td} font-mono ${tone ? TONE[tone] : ""}`}>
                    {holdProviderLine(requirement)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {impact.map((line) => (
        <p key={line} className="mt-2 mb-0 text-xs text-danger">
          {line}
        </p>
      ))}
    </div>
  );
};

const Bindings = ({ rows }: { rows: BindingRow[] }) => (
  <>
    <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Bindings</h2>
    <Card className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className={th}>Dependent</th>
            <th className={th}>Contract</th>
            <th className={th}>Bound to</th>
            <th className={th}>Health</th>
            <th className={th}>Grant</th>
            <th className={th}>Provider</th>
            <th className={th}>Caller</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.dependent}:${row.contract}`} className="[&:last-child>td]:border-b-0">
              <td className={`${td} font-mono`}>{row.dependent}</td>
              <td className={`${td} font-mono`}>{row.contract}</td>
              <td
                className={`${td} font-mono ${row.boundTone !== "ok" ? TONE[row.boundTone] : ""}`}
              >
                {row.boundTo}
              </td>
              <td className={`${td} ${TONE[row.healthTone]}`}>{row.health}</td>
              <td className={`${td} ${row.grant === "none" ? "text-muted" : ""}`}>{row.grant}</td>
              <td
                className={`${td} font-mono ${row.providerIdentity === "none" ? "text-muted" : ""}`}
              >
                {row.providerIdentity}
              </td>
              <td
                className={`${td} font-mono ${row.callerIdentity === "none" ? "text-muted" : ""}`}
              >
                {row.callerIdentity}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  </>
);

const Grants = ({ rows }: { rows: GrantRow[] }) => (
  <>
    <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Grants</h2>
    <Card className="overflow-x-auto">
      {rows.length === 0 ? (
        <p className="m-0 px-3.5 py-3 text-xs text-muted">{COPY.empty}</p>
      ) : (
        <table className="w-full border-collapse text-xs" aria-label="Grants">
          <thead>
            <tr>
              <th className={th}>Instance</th>
              <th className={th}>Caller</th>
              <th className={th}>Contract</th>
              <th className={th}>Binding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.instance}:${row.contract}:${row.caller}`}
                className="[&:last-child>td]:border-b-0"
              >
                <td className={`${td} font-mono`}>{row.instance}</td>
                <td className={`${td} font-mono`}>{row.caller}</td>
                <td className={`${td} font-mono`}>{row.contract}</td>
                <td className={`${td} font-mono`}>{row.binding}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  </>
);

export default EnvironmentDependencies;
