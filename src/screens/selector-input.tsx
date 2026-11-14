import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { matchLine } from "../delivery/hold";
import { fetchSelectorMatch, type SelectorMatch } from "../management/selectors";

const field =
  "min-w-0 flex-1 rounded-md border border-field bg-white/4 px-2.5 py-1.5 font-mono text-xs text-fg placeholder:text-muted";

/** How long typing must pause before the server is asked for a match. */
export const PREVIEW_DELAY_MS = 300;

/**
 * A selector as typed and the server's match for it. The server is asked
 * once typing pauses; until it answers for the current text, `match` is
 * undefined. The browser never evaluates the selector.
 */
export const useSelectorMatch = (token: string, text: string) => {
  const selector = text.trim();
  const [settled, setSettled] = useState(selector);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(selector), PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [selector]);
  const query = useQuery({
    queryKey: ["selector", settled, token],
    queryFn: () => fetchSelectorMatch(settled, token),
    enabled: settled !== "",
    retry: false,
  });
  const current = settled === selector && selector !== "";
  return { selector, match: current && !query.isFetching ? query.data : undefined };
};

const previewLine = (match: SelectorMatch): string => {
  if (match.kind === "ok") {
    return match.value.length === 0
      ? "matches none"
      : `matches ${match.value.length}: ${matchLine(match.value)}`;
  }
  if (match.kind === "invalid") {
    return match.clause === undefined ? "invalid selector" : `invalid clause: ${match.clause}`;
  }
  if (match.kind === "error") {
    return match.message;
  }
  return match.kind === "forbidden" ? "No access" : "This server cannot match selectors.";
};

/**
 * A label selector field (`key=value`, `key!=value`, `key in (a,b)`, comma
 * separated) with the server's live match under it.
 */
export const SelectorInput = ({
  label,
  text,
  onChange,
  selector,
  match,
}: {
  label: string;
  text: string;
  onChange: (text: string) => void;
} & ReturnType<typeof useSelectorMatch>) => (
  <div className="flex w-full min-w-0 flex-col gap-1">
    <input
      aria-label={label}
      placeholder="tier=web,region in (eu,us)"
      value={text}
      onChange={(event) => onChange(event.target.value)}
      className={field}
    />
    {selector !== "" && (
      <p
        aria-label={`${label} match`}
        aria-live="polite"
        className={`m-0 text-xs wrap-anywhere ${
          match === undefined
            ? "text-muted"
            : match.kind === "invalid"
              ? "text-danger"
              : match.kind === "ok"
                ? "text-fg"
                : "text-muted"
        }`}
      >
        {match === undefined ? "Matching" : previewLine(match)}
      </p>
    )}
  </div>
);
