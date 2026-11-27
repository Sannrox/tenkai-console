import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { useSession } from "../auth/session";
import { searchHits } from "../delivery/search";
import { useSearchCatalog } from "../delivery/use-search-catalog";
import {
  ActionsBody,
  ConfirmButton,
  menuItemClass,
  usePageActions,
  type ActionItem,
} from "../ui/kit";
import { SearchHitLink } from "./search-hits";

const field =
  "min-w-0 w-full rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";

const matchesQuery = (text: string, query: string): boolean => {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || text.toLowerCase().includes(needle);
};

const textOf = (node: ReactNode): string => {
  if (node == null || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(textOf).join(" ");
  }
  if (!isValidElement(node)) {
    return "";
  }
  if (node.type === ConfirmButton) {
    return (node.props as { label: string }).label;
  }
  return textOf((node.props as { children?: ReactNode }).children);
};

const hasNode = (node: ReactNode): boolean => {
  if (node == null || typeof node === "boolean") {
    return false;
  }
  if (Array.isArray(node)) {
    return node.some(hasNode);
  }
  return true;
};

const filterNodes = (node: ReactNode, query: string): ReactNode => {
  if (query.trim() === "") {
    return node;
  }
  return Children.map(node, (child) => {
    if (!hasNode(child)) {
      return null;
    }
    return matchesQuery(textOf(child), query) ? child : null;
  });
};

const bindClose = (node: ReactNode, onClose: () => void): ReactNode =>
  Children.map(node, (child) => {
    if (!isValidElement(child)) {
      return child;
    }
    if (child.type === ConfirmButton) {
      const onConfirm = (child.props as { onConfirm: () => void }).onConfirm;
      return cloneElement(child as ReactElement<{ onConfirm: () => void }>, {
        onConfirm: () => {
          onConfirm();
          onClose();
        },
      });
    }
    const props = child.props as {
      children?: ReactNode;
      onClick?: (event: unknown) => void;
      to?: unknown;
    };
    if (props.to !== undefined) {
      return cloneElement(child as ReactElement<{ onClick?: (event: unknown) => void }>, {
        onClick: (event: unknown) => {
          props.onClick?.(event);
          onClose();
        },
      });
    }
    if (props.children !== undefined) {
      return cloneElement(child as ReactElement<{ children?: ReactNode }>, {
        children: bindClose(props.children, onClose),
      });
    }
    return child;
  });

const filterItems = (items: ReadonlyArray<ActionItem> | undefined, query: string): ActionItem[] =>
  (items ?? []).filter((item) => matchesQuery(item.label, query));

/** Overlay opened with Control or Meta K, the sidebar field, or /search. */
export const QuickSearch = ({ onClose }: { onClose: () => void }) => {
  const token = useSession((state) => state.session?.accessToken);
  const catalog = useSearchCatalog(token);
  const [query, setQuery] = useState("");
  const hits = searchHits(query, catalog);
  const page = usePageActions();
  const actionItems = filterItems(page?.items, query);
  const actionChildren = filterNodes(page?.children, query);
  const hasActions = actionItems.length > 0 || hasNode(actionChildren);
  const typed = query.trim() !== "";
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
        {hasActions && (
          <div className="mb-2">
            <div className="px-0.5 text-xs text-muted">Actions</div>
            <div role="list" aria-label="Actions">
              {actionItems.map((item) => (
                <div key={item.label} role="listitem">
                  <button
                    type="button"
                    disabled={item.disabled}
                    className={menuItemClass}
                    onClick={() => {
                      item.onClick();
                      onClose();
                    }}
                  >
                    {item.label}
                  </button>
                </div>
              ))}
              {hasNode(actionChildren) && (
                <div role="listitem">
                  <ActionsBody>{bindClose(actionChildren, onClose)}</ActionsBody>
                </div>
              )}
            </div>
          </div>
        )}
        {typed ? (
          hits.length > 0 ? (
            <div role="list" aria-label="Results">
              {hasActions && <div className="px-0.5 text-xs text-muted">Objects</div>}
              {hits.map((hit) => (
                <div key={hit.key} role="listitem">
                  <SearchHitLink hit={hit} onPick={onClose} />
                </div>
              ))}
            </div>
          ) : hasActions ? null : (
            <p className="m-0 text-xs text-muted">No matches.</p>
          )
        ) : (
          <p className="m-0 text-xs text-muted">Type to find an object.</p>
        )}
      </div>
    </div>
  );
};
