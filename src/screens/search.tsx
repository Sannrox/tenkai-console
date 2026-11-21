import { useState } from "react";
import { useSession } from "../auth/session";
import { searchHits } from "../delivery/search";
import { useSearchCatalog } from "../delivery/use-search-catalog";
import { SearchHitLink } from "./search-hits";

const field =
  "min-w-0 w-full rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

/** Find environments, products, releases, runners and findings by name. */
export const SearchPage = () => {
  const token = useSession((state) => state.session?.accessToken);
  const catalog = useSearchCatalog(token);
  const [query, setQuery] = useState("");
  const hits = searchHits(query, catalog);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Search</h1>
      </div>
      <input
        aria-label="Search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Name or plan id"
        className={`mb-3 ${field}`}
      />
      {query.trim() === "" ? (
        <p className="m-0 text-xs text-muted">
          Type to find environments, products, releases, runners and findings.
        </p>
      ) : hits.length === 0 ? (
        <p className="m-0 text-xs text-muted">No matches.</p>
      ) : (
        <div role="list" aria-label="Results">
          {hits.map((hit) => (
            <div key={hit.key} role="listitem">
              <SearchHitLink hit={hit} />
            </div>
          ))}
        </div>
      )}
    </>
  );
};
