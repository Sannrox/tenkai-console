import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAuthSession } from "../auth/identity";
import { environmentLabelsPath, fetchLabels, labelLine } from "../management/labels";
import { ConfirmButton } from "../ui/kit";
import { type FormProps, Input, Section, useDraftGeneration } from "./environment-config";

const COPY = { unavailable: "This server does not report labels.", forbidden: "No access" };

/**
 * Labels on one environment, loaded lazily from `ConfigSections` and sent
 * through its call: one `set_label` or `clear_label` with a reason and the
 * draft's generation. The read lives under the `environment` query key, so
 * every settled call refreshes it. Hidden editor without management.
 */
const EnvironmentLabels = ({
  environment,
  token,
  allowed,
  ...form
}: FormProps & { environment: string; token: string; allowed: boolean }) => {
  const query = useQuery({
    queryKey: ["environment", environment, "labels", token],
    queryFn: () => fetchLabels(environmentLabelsPath(environment), token),
    retry: false,
  });
  const me = useAuthSession(token);
  const grants = me.data?.capabilities;
  const load = query.data;
  const permitted =
    allowed &&
    load?.kind === "ok" &&
    !me.isPending &&
    (grants === undefined || grants.includes("management"));
  return (
    <Section
      title="Labels"
      allowed={permitted}
      summary={
        load === undefined
          ? "Loading"
          : load.kind === "ok"
            ? labelLine(load.labels)
            : load.kind === "error"
              ? load.message
              : COPY[load.kind]
      }
    >
      <LabelsForm {...form} />
    </Section>
  );
};

const LabelsForm = ({ pending, generation, send }: FormProps) => {
  const [draft] = useDraftGeneration(generation);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const ready = !pending && key.trim() !== "" && reason.trim() !== "";
  return (
    <>
      <Input label="Label key" value={key} onChange={setKey} />
      <Input label="Label value" value={value} onChange={setValue} />
      <Input label="Reason" value={reason} onChange={setReason} className="flex-1" />
      <ConfirmButton
        label="Set"
        confirm={`Set label ${key.trim()}=${value.trim()}`}
        disabled={!ready || !value.trim()}
        onConfirm={() =>
          send(draft, reason, { kind: "set_label", key: key.trim(), value: value.trim() })
        }
      />
      <ConfirmButton
        label="Clear"
        confirm={`Clear label ${key.trim()}`}
        disabled={!ready}
        onConfirm={() => send(draft, reason, { kind: "clear_label", key: key.trim() })}
      />
    </>
  );
};

export default EnvironmentLabels;
