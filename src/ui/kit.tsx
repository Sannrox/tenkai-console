import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
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

/** Extra actions next to one primary control. */
export const ActionsMenu = ({
  items,
}: {
  items: ReadonlyArray<{ label: string; onClick: () => void; disabled?: boolean }>;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
        Actions
      </Button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 min-w-44 border border-line bg-page p-1 text-xs">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              className="block w-full cursor-pointer rounded px-1.5 py-1 text-left text-fg hover:bg-selected disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
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
 * Shared object page: type, name, status, one primary action plus Actions,
 * a pin star, a key property strip, tabs, then attention, main, and linked.
 */
export const ObjectPage = ({
  kind,
  name,
  id,
  status,
  primary,
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
  primary?: ReactNode;
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
      {kind && <div className="text-xs text-muted">{kind}</div>}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">{name}</h1>
        {status && <span className="text-xs text-muted">{status}</span>}
        {(primary || actions || saved) && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {primary}
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
