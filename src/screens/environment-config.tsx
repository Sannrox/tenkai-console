import { useState, type ReactNode } from "react";
import type {
  ConnectivityClass,
  EnvironmentConfigChange,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
  OperationalEvent,
  WebhookEndpoint,
  WebhookEvent,
} from "../api/tenkai.gen";
import { formatViewerInstant } from "../delivery/maintenance";
import { configCall, nextOpening, registerBody } from "../management/environment-config";
import { useManagementCall } from "../management/use-management";
import { expectedGeneration } from "../plan/requests";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const message = (result: ManagementLifecycleResult) => result.message;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const Input = ({
  label,
  value,
  onChange,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) => (
  <input
    aria-label={label}
    placeholder={label}
    value={value}
    onChange={(event) => onChange(event.target.value)}
    className={`${field} ${className}`}
  />
);

/**
 * "Add environment" (#33): `POST /v1/environments` with a reason. Only a
 * fleet-wide management credential may register; a refusal hides the
 * button and stays visible.
 */
export const AddEnvironment = ({ token }: { token: string }) => {
  const register = useManagementCall(token, "fleet", "management", message);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [connectivity, setConnectivity] = useState<ConnectivityClass | "">("");
  const [reason, setReason] = useState("");
  if (!register.allowed && !register.outcome) {
    return null;
  }
  return (
    <>
      {register.allowed && !open && (
        <Button variant="primary" className="ml-auto" onClick={() => setOpen(true)}>
          Add environment
        </Button>
      )}
      {open && (
        <Card className="mb-3 flex w-full flex-wrap items-center gap-2 px-3.5 py-3 text-xs">
          <Input label="Environment name" value={name} onChange={setName} />
          <Input
            label="Description"
            value={description}
            onChange={setDescription}
            className="flex-1"
          />
          <select
            aria-label="Connectivity"
            value={connectivity}
            onChange={(event) => setConnectivity(event.target.value as ConnectivityClass | "")}
            className={field}
          >
            <option value="">Connectivity: default</option>
            <option value="connected">connected</option>
            <option value="intermittent">intermittent</option>
            <option value="isolated">isolated</option>
          </select>
          <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
          {register.allowed && (
            <ConfirmButton
              label="Add"
              confirm={`Add ${name.trim()}`}
              disabled={register.isPending || !name.trim() || !reason.trim()}
              onConfirm={() =>
                register.mutate({
                  path: "v1/environments",
                  body: registerBody(name, description, connectivity, reason),
                })
              }
            />
          )}
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Close
          </Button>
        </Card>
      )}
      {register.outcome && (
        <div className="mb-3 w-full">
          <Notice tone={register.outcome.tone}>{register.outcome.text}</Notice>
        </div>
      )}
    </>
  );
};

/**
 * Pick A (#33): facts, constraints, maintenance windows, webhooks and the
 * approval-policy path each with their own Edit. A change is one request
 * with a reason and the generation this view shows; a stale generation is
 * refused by the server, not retried, so an edit never overwrites a change
 * this page did not show. Read-only credentials see no Edit once the server
 * has refused them.
 */
export const ConfigSections = ({
  report,
  token,
}: {
  report: EnvironmentInspectReport;
  token: string;
}) => {
  const call = useManagementCall(token, `environment:${report.name}`, "management", message);
  const generation = expectedGeneration(report.lease);
  const send = (draft: number, reason: string, change: EnvironmentConfigChange) =>
    call.mutate(configCall(report.name, draft, reason, change));
  const props = { pending: call.isPending, generation, send };
  return (
    <>
      <Section title="Facts" allowed={call.allowed}>
        <FactsForm {...props} />
      </Section>
      <Section title="Constraints" allowed={call.allowed}>
        <ConstraintsForm {...props} />
      </Section>
      <Section title="Maintenance windows" allowed={call.allowed}>
        <WindowForm
          {...props}
          existing={report.maintenance?.windows.map((w) => w.identity) ?? []}
        />
      </Section>
      <Section
        title="Webhooks"
        allowed={call.allowed}
        summary={
          (report.webhooks ?? []).length === 0
            ? "none"
            : (report.webhooks ?? []).map(webhookLine).join(" · ")
        }
      >
        <WebhooksForm {...props} webhooks={report.webhooks ?? []} />
      </Section>
      <Section
        title="Approval policy"
        allowed={call.allowed}
        summary={report.approval_policy ?? "none"}
      >
        <PolicyForm {...props} current={report.approval_policy} />
      </Section>
      {call.outcome && (
        <div className="mt-2">
          <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>
        </div>
      )}
    </>
  );
};

type FormProps = {
  pending: boolean;
  /** The generation the report shows now. */
  generation: number;
  /** Sends with the generation the draft was started from, not the latest. */
  send: (draft: number, reason: string, change: EnvironmentConfigChange) => void;
};

/**
 * The generation a form's draft starts from: when the form opens, or when
 * `restart` loads new values into it. A refreshed report does not move it,
 * so a stale draft is refused by the server instead of overwriting a change
 * made since.
 */
const useDraftGeneration = (generation: number) => {
  const [draft, setDraft] = useState(generation);
  return [draft, () => setDraft(generation)] as const;
};

/** A section header with its own Edit, which opens its form. */
const Section = ({
  title,
  allowed,
  summary,
  children,
}: {
  title: string;
  allowed: boolean;
  /** What is configured now, shown whether or not the form is open. */
  summary?: string;
  children: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-xs font-semibold">{title}</h3>
        {allowed && (
          <Button variant="ghost" onClick={() => setOpen(!open)}>
            {open ? "Close" : "Edit"}
          </Button>
        )}
      </div>
      {summary !== undefined && (
        <p aria-label={`${title} configured`} className="m-0 text-xs break-all text-muted">
          {summary}
        </p>
      )}
      {allowed && open && (
        <Card className="mt-1 flex flex-wrap items-center gap-2 px-3.5 py-3 text-xs">
          {children}
        </Card>
      )}
    </div>
  );
};

const FactsForm = ({ pending, generation, send }: FormProps) => {
  const [draft] = useDraftGeneration(generation);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const ready = !pending && key.trim() !== "" && reason.trim() !== "";
  return (
    <>
      <Input label="Fact key" value={key} onChange={setKey} />
      <Input label="Fact value" value={value} onChange={setValue} />
      <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
      <ConfirmButton
        label="Set"
        confirm={`Set ${key.trim()}=${value.trim()}`}
        disabled={!ready || !value.trim()}
        onConfirm={() =>
          send(draft, reason, { kind: "set_fact", key: key.trim(), value: value.trim() })
        }
      />
      <ConfirmButton
        label="Clear"
        confirm={`Clear ${key.trim()}`}
        disabled={!ready}
        onConfirm={() => send(draft, reason, { kind: "clear_fact", key: key.trim() })}
      />
    </>
  );
};

const CONSTRAINTS = ["version_pin", "version_range", "require_fact"] as const;

const ConstraintsForm = ({ pending, generation, send }: FormProps) => {
  const [draft] = useDraftGeneration(generation);
  const [constraint, setConstraint] = useState<(typeof CONSTRAINTS)[number]>("version_pin");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const ready = !pending && name.trim() !== "" && reason.trim() !== "";
  return (
    <>
      <select
        aria-label="Constraint"
        value={constraint}
        onChange={(event) => setConstraint(event.target.value as (typeof CONSTRAINTS)[number])}
        className={field}
      >
        {CONSTRAINTS.map((kind) => (
          <option key={kind} value={kind}>
            {kind}
          </option>
        ))}
      </select>
      <Input
        label={constraint === "require_fact" ? "Fact key" : "Product"}
        value={name}
        onChange={setName}
      />
      <Input label="Constraint value" value={value} onChange={setValue} />
      <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
      <ConfirmButton
        label="Set"
        confirm={`Set ${constraint} ${name.trim()} ${value.trim()}`}
        disabled={!ready || !value.trim()}
        onConfirm={() =>
          send(draft, reason, {
            kind: "set_constraint",
            constraint,
            name: name.trim(),
            value: value.trim(),
          })
        }
      />
      <ConfirmButton
        label="Clear"
        confirm={`Clear ${constraint} ${name.trim()}`}
        disabled={!ready}
        onConfirm={() =>
          send(draft, reason, { kind: "clear_constraint", constraint, name: name.trim() })
        }
      />
    </>
  );
};

const WindowForm = ({
  pending,
  generation,
  send,
  existing,
}: FormProps & { existing: string[] }) => {
  const [draft] = useDraftGeneration(generation);
  const [name, setName] = useState(existing[0] ?? "");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const [start, setStart] = useState("02:00");
  const [duration, setDuration] = useState("60");
  const [reason, setReason] = useState("");
  // Preview only: computed when inputs change, against the time of render.
  const [now] = useState(Date.now);
  const minutes = Number(duration);
  const preview = nextOpening({ name, timezone, weekdays, start, durationMinutes: minutes }, now);
  const ready = !pending && name.trim() !== "" && reason.trim() !== "";
  return (
    <>
      <Input label="Window name" value={name} onChange={setName} />
      <Input label="Time zone" value={timezone} onChange={setTimezone} />
      <div className="flex gap-1" role="group" aria-label="Weekdays">
        {DAYS.map((day, index) => (
          <label key={day} className="flex items-center gap-0.5">
            <input
              type="checkbox"
              checked={weekdays.includes(index + 1)}
              onChange={(event) =>
                setWeekdays((current) =>
                  event.target.checked
                    ? [...current, index + 1].toSorted((a, b) => a - b)
                    : current.filter((weekday) => weekday !== index + 1),
                )
              }
            />
            {day}
          </label>
        ))}
      </div>
      <Input label="Start" value={start} onChange={setStart} className="w-20" />
      <Input label="Minutes" value={duration} onChange={setDuration} className="w-20" />
      <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
      <p aria-label="Next window" className="m-0 w-full text-muted">
        {typeof preview === "number"
          ? `Next opens ${formatViewerInstant(preview)} your time`
          : `No preview: ${preview}`}
      </p>
      <ConfirmButton
        label="Save"
        confirm={`Save window ${name.trim()}`}
        disabled={!ready || typeof preview === "string" || !Number.isInteger(minutes)}
        onConfirm={() =>
          send(draft, reason, {
            kind: "set_maintenance_window",
            name: name.trim(),
            timezone: timezone.trim(),
            weekdays,
            start,
            duration_minutes: minutes,
          })
        }
      />
      <ConfirmButton
        label="Remove"
        confirm={`Remove window ${name.trim()}`}
        disabled={!ready}
        onConfirm={() =>
          send(draft, reason, { kind: "remove_maintenance_window", name: name.trim() })
        }
      />
    </>
  );
};

const APPLY_EVENTS: WebhookEvent[] = ["apply.succeeded", "apply.failed", "apply.rolled_back"];
/** Operational events an environment's webhooks receive; host events go elsewhere. */
const ENVIRONMENT_EVENTS: OperationalEvent[] = [
  "plan.held",
  "plan.awaiting_approval",
  "import.failed",
  "runner.attestation_refused",
];

/**
 * The apply outcomes a webhook receives, as the server decides: its listed
 * events, or, when it lists none, every outcome unless it lists operational
 * events only (then none).
 */
const applySubscription = (hook: WebhookEndpoint): WebhookEvent[] =>
  (hook.events ?? []).length > 0
    ? (hook.events ?? [])
    : (hook.operational ?? []).length > 0
      ? []
      : APPLY_EVENTS;

/** `url (SECRET_ENV) events`, with the apply outcomes it actually receives. */
const webhookLine = (hook: WebhookEndpoint): string =>
  `${hook.url} (${hook.secret_env}) ${[...applySubscription(hook), ...(hook.operational ?? [])].join(",")}`;

const toggle = <T extends string>(list: T[], item: T, on: boolean): T[] =>
  on ? [...list.filter((value) => value !== item), item] : list.filter((value) => value !== item);

/**
 * Add or replace one webhook by URL (the server keeps the others), or
 * remove one by URL. Picking a configured webhook loads all its fields, so
 * saving it keeps what it subscribed to. Only the variable that holds the
 * secret is entered, never the secret. Removing every webhook at once is
 * not offered.
 */
const WebhooksForm = ({
  pending,
  generation,
  send,
  webhooks,
}: FormProps & { webhooks: WebhookEndpoint[] }) => {
  const [draft, restart] = useDraftGeneration(generation);
  const [url, setUrl] = useState("");
  const [secretEnv, setSecretEnv] = useState("");
  // A new webhook starts with every apply outcome, as the server would.
  const [events, setEvents] = useState<WebhookEvent[]>(APPLY_EVENTS);
  const [operational, setOperational] = useState<OperationalEvent[]>([]);
  const [reason, setReason] = useState("");
  const load = (hook: WebhookEndpoint) => {
    restart();
    setUrl(hook.url);
    setSecretEnv(hook.secret_env);
    setEvents(applySubscription(hook));
    setOperational(hook.operational ?? []);
  };
  const configured = webhooks.some((hook) => hook.url === url.trim());
  // Keep any event an existing webhook lists, even one this page does not offer.
  const operationalChoices = [...new Set([...ENVIRONMENT_EVENTS, ...operational])];
  const ready = !pending && url.trim() !== "" && reason.trim() !== "";
  // An empty list would mean every apply outcome to the server, the
  // opposite of nothing checked; events are always sent explicitly.
  const nothing = events.length === 0 && operational.length === 0;
  return (
    <>
      {webhooks.length > 0 && (
        <div className="flex w-full flex-wrap gap-1.5">
          {webhooks.map((hook) => (
            <Button key={hook.url} variant="ghost" onClick={() => load(hook)}>
              {hook.url}
            </Button>
          ))}
        </div>
      )}
      <Input label="Webhook URL" value={url} onChange={setUrl} className="flex-1" />
      <Input label="Secret variable" value={secretEnv} onChange={setSecretEnv} />
      <div role="group" aria-label="Events" className="flex w-full flex-wrap gap-2">
        {APPLY_EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={events.includes(event)}
              onChange={(change) => setEvents(toggle(events, event, change.target.checked))}
            />
            {event}
          </label>
        ))}
        {operationalChoices.map((event) => (
          <label key={event} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={operational.includes(event)}
              onChange={(change) =>
                setOperational(toggle(operational, event, change.target.checked))
              }
            />
            {event}
          </label>
        ))}
      </div>
      {nothing && (
        <p role="alert" className="m-0 w-full text-warning">
          Choose at least one outcome
        </p>
      )}
      <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
      <ConfirmButton
        label={configured ? "Save" : "Add"}
        confirm={`${configured ? "Save" : "Add"} webhook ${url.trim()}`}
        disabled={!ready || !secretEnv.trim() || nothing}
        onConfirm={() =>
          send(draft, reason, {
            kind: "set_webhook",
            url: url.trim(),
            secret_env: secretEnv.trim(),
            events,
            operational,
          })
        }
      />
      {configured && (
        <ConfirmButton
          label="Remove"
          confirm={`Remove webhook ${url.trim()}`}
          disabled={!ready}
          onConfirm={() => send(draft, reason, { kind: "clear_webhooks", url: url.trim() })}
        />
      )}
    </>
  );
};

/** Point the environment at a policy file on the server host, or clear it. */
const PolicyForm = ({
  pending,
  generation,
  send,
  current,
}: FormProps & { current: string | undefined }) => {
  const [draft] = useDraftGeneration(generation);
  const [path, setPath] = useState(current ?? "");
  const [reason, setReason] = useState("");
  const ready = !pending && reason.trim() !== "";
  return (
    <>
      <Input label="Policy file path" value={path} onChange={setPath} className="flex-1" />
      <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
      <ConfirmButton
        label="Set"
        confirm={`Set policy ${path.trim()}`}
        disabled={!ready || !path.trim()}
        onConfirm={() => send(draft, reason, { kind: "set_approval_policy", path: path.trim() })}
      />
      {current !== undefined && (
        <ConfirmButton
          label="Clear"
          confirm="Clear the approval policy"
          disabled={!ready}
          onConfirm={() => send(draft, reason, { kind: "clear_approval_policy" })}
        />
      )}
    </>
  );
};
