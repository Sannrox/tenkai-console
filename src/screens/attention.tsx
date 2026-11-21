import { useState } from "react";
import { useSession } from "../auth/session";
import { ATTENTION_KINDS, type AttentionKind } from "../delivery/configuration";
import { useAttention } from "../delivery/use-attention";
import { Button } from "../ui/kit";
import { AttentionList } from "./attention-list";

const KIND_LABEL: Record<AttentionKind, string> = {
  environment: "Environment",
  finding: "Finding",
  runner: "Runner",
  release: "Release",
  event: "Event",
};

/** Fleet-wide objects that need a person, filterable by type. */
export const AttentionPage = () => {
  const token = useSession((state) => state.session?.accessToken);
  const attention = useAttention(token);
  const [kind, setKind] = useState<AttentionKind | "all">("all");
  const items =
    kind === "all" ? attention.items : attention.items.filter((item) => item.kind === kind);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Attention</h1>
        <span className="text-xs text-muted">
          {attention.loading
            ? "Loading"
            : items.length === 0
              ? "Nothing needs you"
              : `${items.length} need you`}
        </span>
      </div>
      {attention.failed.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-warning">
          <span>The list may be incomplete.</span>
          <Button onClick={attention.retry}>Retry</Button>
        </div>
      )}
      <p className="mb-3 text-xs text-muted">
        Plan approvals, drift and certificate warnings stay on the environment.
      </p>
      <nav aria-label="Type" className="mb-3 flex flex-wrap gap-3 text-[13px] font-medium">
        <Filter current={kind === "all"} onClick={() => setKind("all")}>
          All
        </Filter>
        {ATTENTION_KINDS.map((item) => (
          <Filter key={item} current={kind === item} onClick={() => setKind(item)}>
            {KIND_LABEL[item]}
          </Filter>
        ))}
      </nav>
      {!attention.loading && <AttentionList items={items} />}
    </>
  );
};

const Filter = ({
  current,
  onClick,
  children,
}: {
  current: boolean;
  onClick: () => void;
  children: string;
}) => (
  <button
    type="button"
    aria-pressed={current}
    onClick={onClick}
    className={`cursor-pointer border-0 bg-transparent p-0 ${
      current ? "text-fg shadow-[inset_0_-2px_0_var(--color-primary)]" : "text-muted"
    }`}
  >
    {children}
  </button>
);
