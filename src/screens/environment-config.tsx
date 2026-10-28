import { useState, type ReactNode } from "react";
import type {
  ConnectivityClass,
  EnvironmentConfigChange,
  EnvironmentInspectReport,
  ManagementLifecycleResult,
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
 * Pick A (#33): facts, constraints and maintenance windows each with their
 * own Edit. A change is one request with a reason and the generation this
 * view shows; a stale generation is refused by the server, not retried.
 * Read-only credentials see no Edit once the server has refused them.
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
  const send = (reason: string, change: EnvironmentConfigChange) =>
    call.mutate(configCall(report.name, generation, reason, change));
  const props = { pending: call.isPending, send };
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
  send: (reason: string, change: EnvironmentConfigChange) => void;
};

/** A section header with its own Edit, which opens its form. */
const Section = ({
  title,
  allowed,
  children,
}: {
  title: string;
  allowed: boolean;
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
      {allowed && open && (
        <Card className="mt-1 flex flex-wrap items-center gap-2 px-3.5 py-3 text-xs">
          {children}
        </Card>
      )}
    </div>
  );
};

const FactsForm = ({ pending, send }: FormProps) => {
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
        onConfirm={() => send(reason, { kind: "set_fact", key: key.trim(), value: value.trim() })}
      />
      <ConfirmButton
        label="Clear"
        confirm={`Clear ${key.trim()}`}
        disabled={!ready}
        onConfirm={() => send(reason, { kind: "clear_fact", key: key.trim() })}
      />
    </>
  );
};

const CONSTRAINTS = ["version_pin", "version_range", "require_fact"] as const;

const ConstraintsForm = ({ pending, send }: FormProps) => {
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
          send(reason, {
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
        onConfirm={() => send(reason, { kind: "clear_constraint", constraint, name: name.trim() })}
      />
    </>
  );
};

const WindowForm = ({ pending, send, existing }: FormProps & { existing: string[] }) => {
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
          send(reason, {
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
        onConfirm={() => send(reason, { kind: "remove_maintenance_window", name: name.trim() })}
      />
    </>
  );
};
