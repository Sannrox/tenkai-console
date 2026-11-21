import { Link } from "@tanstack/react-router";
import type { FleetAttention } from "../delivery/configuration";
import { parseReleaseSpec } from "./objects";

const DOT = { warn: "bg-warning", bad: "bg-danger" } as const;

const KIND_LABEL: Record<FleetAttention["kind"], string> = {
  environment: "environment",
  finding: "finding",
  runner: "runner",
  release: "release",
  event: "event",
};

/** One attention row: object name, why it needs a person, and the next step. */
export const AttentionList = ({ items }: { items: readonly FleetAttention[] }) => {
  if (items.length === 0) {
    return <p className="m-0 text-xs text-muted">Nothing needs you.</p>;
  }
  return (
    <div role="list" aria-label="Attention">
      {items.map((item) => (
        <div
          key={item.key}
          role="listitem"
          className="grid grid-cols-[10px_1fr_auto] items-center gap-3 border-t border-line py-2.5 first:border-t-0"
        >
          <span className={`size-[7px] rounded-full ${DOT[item.tone]}`} />
          <div>
            <div className="text-[13px] font-semibold">{item.title}</div>
            <div className="text-xs text-muted">
              {KIND_LABEL[item.kind]} · {item.detail}
            </div>
          </div>
          <AttentionNext item={item} />
        </div>
      ))}
    </div>
  );
};

const linkClass =
  "inline-flex items-center rounded-md border border-field px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap text-fg no-underline";

const AttentionNext = ({ item }: { item: FleetAttention }) => {
  if (item.kind === "environment" && item.environment !== undefined) {
    return (
      <Link
        to="/environments/$environment"
        params={{ environment: item.environment }}
        className={linkClass}
      >
        {item.next}
      </Link>
    );
  }
  if (item.kind === "finding" && item.advisory !== undefined) {
    return (
      <Link
        to="/findings/$advisory"
        params={{ advisory: item.advisory }}
        search={item.release === undefined ? {} : { release: item.release }}
        className={linkClass}
      >
        {item.next}
      </Link>
    );
  }
  if (item.kind === "runner" && item.runnerId !== undefined) {
    return (
      <Link to="/runners/$runnerId" params={{ runnerId: item.runnerId }} className={linkClass}>
        {item.next}
      </Link>
    );
  }
  if (item.kind === "release") {
    const parsed = parseReleaseSpec(item.title);
    if (parsed !== undefined) {
      return (
        <Link to="/releases/$product/$version" params={parsed} className={linkClass}>
          {item.next}
        </Link>
      );
    }
  }
  if (item.kind === "event" && item.environment !== undefined) {
    return (
      <Link
        to="/environments/$environment"
        params={{ environment: item.environment }}
        className={linkClass}
      >
        {item.next}
      </Link>
    );
  }
  return <span className="text-xs text-muted">{item.next}</span>;
};
