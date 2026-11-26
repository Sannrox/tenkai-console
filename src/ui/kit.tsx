import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { objectKey, useSaved, type ObjectKind, type SavedObject } from "./saved";

/** Primitives matching the reference mock: cards, buttons, a centered panel. */

export const Card = ({ className = "", ...props }: ComponentProps<"div">) => (
  <div className={`rounded-card border border-line bg-card ${className}`} {...props} />
);

type ButtonProps = ComponentProps<"button"> & { variant?: "primary" | "plain" | "ghost" };

export const Button = ({ variant = "plain", className = "", ...props }: ButtonProps) => {
  const look = {
    primary: "border-primary bg-primary text-surface",
    plain: "border-field text-fg",
    ghost: "border-transparent text-muted",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50 ${look} ${className}`}
      {...props}
    />
  );
};

/** One result line: green for done, red for a server refusal, amber for unknown. */
export const Notice = ({
  tone,
  children,
}: {
  tone: "ok" | "bad" | "unknown";
  children: ReactNode;
}) => (
  <p
    role={tone === "bad" ? "alert" : "status"}
    className={`m-0 text-xs ${{ ok: "text-ok", bad: "text-danger", unknown: "text-warning" }[tone]}`}
  >
    {children}
  </p>
);

const ActionsArm = createContext<((delta: 1 | -1) => void) | null>(null);

const MENU_ITEM =
  "block w-full cursor-pointer rounded px-1.5 py-1 text-left text-xs font-medium text-fg hover:bg-selected disabled:cursor-not-allowed disabled:opacity-50";

/** Row class for links and custom controls inside Actions. */
export const menuItemClass = MENU_ITEM;

/** A mutation trigger that asks once: the first click arms it, the second sends. */
export const ConfirmButton = ({
  label,
  confirm,
  disabled,
  onConfirm,
}: {
  label: string;
  /** Names exactly what will be sent, so the confirmation is the preview. */
  confirm: string;
  disabled: boolean;
  onConfirm: () => void;
}) => {
  const [armed, setArmed] = useState(false);
  const report = useContext(ActionsArm);
  useEffect(() => {
    if (!report || !armed) {
      return () => undefined;
    }
    report(1);
    return () => report(-1);
  }, [armed, report]);
  if (report) {
    if (!armed) {
      return (
        <button
          type="button"
          disabled={disabled}
          className={MENU_ITEM}
          onClick={() => setArmed(true)}
        >
          {label}
        </button>
      );
    }
    return (
      <>
        <button
          type="button"
          disabled={disabled}
          className={`${MENU_ITEM} bg-primary text-surface`}
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
        >
          {confirm}
        </button>
        <button type="button" className={`${MENU_ITEM} text-muted`} onClick={() => setArmed(false)}>
          Cancel
        </button>
      </>
    );
  }
  if (!armed) {
    return (
      <Button disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </Button>
    );
  }
  return (
    <>
      <Button
        variant="primary"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirm}
      </Button>
      <Button variant="ghost" onClick={() => setArmed(false)}>
        Cancel
      </Button>
    </>
  );
};

/** Full-height centered column used by sign-in and server status screens. */
export const Centered = ({ children }: { children: ReactNode }) => (
  <main className="grid min-h-screen place-items-center bg-page p-6">
    <Card className="w-full max-w-[380px] p-[22px]">{children}</Card>
  </main>
);

export const Title = ({ subtitle }: { subtitle: string }) => (
  <>
    <div className="text-[15px] font-semibold">Tenkai</div>
    <div className="mb-4 text-xs text-muted">{subtitle}</div>
  </>
);

/** Underline for the current tab; used by the object page and Platform. */
export const tabClass = (current: boolean) =>
  current
    ? "py-1.5 text-fg no-underline shadow-[inset_0_-2px_0_var(--color-primary)]"
    : "py-1.5 text-muted no-underline";

/** Count slot extras: incomplete list or a lost write. */
export const headingCount = (count: string, extra?: "incomplete" | "unknown"): string =>
  extra === "unknown"
    ? `${count} · outcome unknown`
    : extra === "incomplete"
      ? `${count} · list incomplete`
      : count;

/** Ghost Actions in the heading corner. A static red point means a needed item. */
export const ActionsMenu = ({
  needed,
  status,
  items,
  children,
}: {
  needed?: boolean | undefined;
  /** Lost-write sentence; not a button. */
  status?: string | undefined;
  items?: ReadonlyArray<{ label: string; onClick: () => void; disabled?: boolean }> | undefined;
  children?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(0);
  const report = useCallback((delta: 1 | -1) => {
    setArmed((count) => Math.max(0, count + delta));
  }, []);
  const mark = Boolean(needed) || armed > 0;
  const hasChildren = children !== undefined && children !== null && children !== false;
  const hasItems = (items !== undefined && items.length > 0) || hasChildren || Boolean(status);
  if (!hasItems) {
    return null;
  }
  return (
    <ActionsArm.Provider value={report}>
      <div className="relative">
        <Button
          variant="ghost"
          aria-expanded={open}
          aria-label="Actions"
          data-needed={mark ? "true" : undefined}
          className="relative"
          onClick={() => setOpen(!open)}
        >
          Actions
          {mark && (
            <span
              aria-hidden
              className="pointer-events-none absolute top-1 right-1 size-1.5 rounded-full bg-danger"
            />
          )}
        </Button>
        {open && (
          <div
            role="menu"
            className="absolute right-0 z-10 mt-1 min-w-44 border border-line bg-page p-1 text-xs"
          >
            {status !== undefined && (
              <p role="status" className="m-0 max-w-64 px-1.5 py-1 text-warning">
                {status}
              </p>
            )}
            {items?.map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={item.disabled}
                className={MENU_ITEM}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            ))}
            {children}
          </div>
        )}
      </div>
    </ActionsArm.Provider>
  );
};

const OBJECT_KINDS = {
  Environment: "environment",
  Product: "product",
  Release: "release",
  Runner: "runner",
  Plan: "plan",
  Finding: "finding",
} as const satisfies Record<string, ObjectKind>;

const savedFrom = (
  kind: string | undefined,
  name: string,
  id: string | undefined,
): SavedObject | undefined => {
  if (kind === undefined || !(kind in OBJECT_KINDS)) {
    return undefined;
  }
  return { kind: OBJECT_KINDS[kind as keyof typeof OBJECT_KINDS], name, id: id ?? name };
};

const PinButton = ({ item }: { item: SavedObject }) => {
  const key = objectKey(item);
  const pinned = useSaved((state) => state.pins.some((entry) => objectKey(entry) === key));
  const togglePin = useSaved((state) => state.togglePin);
  return (
    <Button
      variant="ghost"
      aria-pressed={pinned}
      aria-label={pinned ? "Unpin" : "Pin"}
      onClick={() => togglePin(item)}
    >
      {pinned ? "★" : "☆"}
    </Button>
  );
};

/**
 * Shared page heading: one name, a short status, Actions in the corner, and
 * a pin star on known objects. Kind is stored for pins, not shown.
 */
export const ObjectPage = ({
  kind,
  name,
  id,
  status,
  actions,
  properties,
  tabs,
  attention,
  main,
  linked,
  children,
}: {
  kind?: string;
  name: string;
  /** Route id when it differs from the heading, such as a runner digest. */
  id?: string;
  status?: ReactNode;
  actions?: ReactNode;
  properties?: ReadonlyArray<{ label: string; value: ReactNode }>;
  tabs?: ReactNode;
  attention?: ReactNode;
  main?: ReactNode;
  linked?: ReactNode;
  children?: ReactNode;
}) => {
  const saved = savedFrom(kind, name, id);
  useEffect(() => {
    const item = savedFrom(kind, name, id);
    if (item) {
      useSaved.getState().visit(item);
    }
  }, [kind, name, id]);
  return (
    <div className="min-w-0 max-w-full">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="m-0 min-w-0 text-lg font-semibold">{name}</h1>
        {status !== undefined && status !== "" && (
          <span className="text-xs text-muted">{status}</span>
        )}
        {(actions || saved) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {actions}
            {saved && <PinButton item={saved} />}
          </div>
        )}
      </div>
      {properties && properties.length > 0 && (
        <dl className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-xs">
          {properties.map((item) => (
            <div key={item.label}>
              <dt className="text-muted">{item.label}</dt>
              <dd className="m-0">{item.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {tabs}
      {children ?? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="min-w-0">
            {attention}
            {main}
          </div>
          {linked}
        </div>
      )}
    </div>
  );
};
