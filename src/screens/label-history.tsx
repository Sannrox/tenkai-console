import { historyLine, type LabelHistoryLoad } from "../management/labels";

const COPY = {
  unavailable: "This server does not report label history.",
  forbidden: "No access",
  empty: "none",
};

const muted = "m-0 text-xs wrap-anywhere text-muted";

/** Recorded set and clear events for one environment or release. */
export const LabelHistory = ({ load }: { load: LabelHistoryLoad | undefined }) => {
  if (load === undefined) {
    return (
      <p aria-label="Label history" className={muted}>
        Loading
      </p>
    );
  }
  if (load.kind !== "ok") {
    return (
      <p aria-label="Label history" className={muted}>
        {load.kind === "error" ? load.message : COPY[load.kind]}
      </p>
    );
  }
  if (load.changes.length === 0) {
    return (
      <p aria-label="Label history" className={muted}>
        {COPY.empty}
      </p>
    );
  }
  return (
    <ul aria-label="Label history" className={`${muted} list-none p-0`}>
      {load.changes.map((change) => (
        <li key={change.id}>{historyLine(change)}</li>
      ))}
    </ul>
  );
};
