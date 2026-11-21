import { useEffect, useRef, useState } from "react";
import { useSession } from "../auth/session";
import { searchHits } from "../delivery/search";
import { useSearchCatalog } from "../delivery/use-search-catalog";
import { SearchHitLink } from "./search-hits";

const field =
  "min-w-0 w-full rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

/** Overlay opened with Control or Meta K. Same catalog as the Search page. */
export const QuickSearch = ({ onClose }: { onClose: () => void }) => {
  const token = useSession((state) => state.session?.accessToken);
  const catalog = useSearchCatalog(token);
  const [query, setQuery] = useState("");
  const hits = searchHits(query, catalog);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-page/80 p-6 pt-[15vh]">
      <div
        role="dialog"
        aria-label="Search"
        className="w-full max-w-lg border border-line bg-page p-3"
      >
        <input
          ref={input}
          aria-label="Search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name or plan id"
          className={`mb-2 ${field}`}
        />
        {query.trim() === "" ? (
          <p className="m-0 text-xs text-muted">
            Type to find environments, products, releases, runners and findings.
          </p>
        ) : (
          <div role="list" aria-label="Results">
            {hits.map((hit) => (
              <div key={hit.key} role="listitem">
                <SearchHitLink hit={hit} onPick={onClose} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
