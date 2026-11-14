import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { OwnerView, WebhookEndpoint, WebhookEvent } from "../api/tenkai.gen";
import {
  endpointsLine,
  fetchProductRouting,
  type Load,
  ownerLine,
  type ProductRouting,
  productPath,
  setOwnerBody,
} from "../delivery/owners";
import { useManagementCall } from "../management/use-management";
import { Button, Card, ConfirmButton, Notice } from "../ui/kit";

const field =
  "min-w-0 rounded-md border border-field bg-white/4 px-2.5 py-1.5 text-xs text-fg placeholder:text-muted";
const th = "border-b border-line px-3.5 py-2 text-left font-medium whitespace-nowrap text-muted";
const td = "border-b border-line px-3.5 py-2 align-top";
const APPLY_EVENTS: WebhookEvent[] = ["apply.succeeded", "apply.failed", "apply.rolled_back"];

/** What a product owner or webhook write answers: the owner view, `null`, or a message. */
const describe = (result: OwnerView | string | null): string =>
  typeof result === "string" ? result : result ? `owner ${result.contact}` : "owner cleared";

const LOAD_TEXT = {
  unavailable: "unavailable",
  forbidden: "No access",
} as const;

/**
 * Product owners and their own notification endpoints, one row per product
 * in the catalog. Product writes carry no generation or reason: the last
 * write wins. Each confirmed click is one request; a lost answer reads as
 * unknown and is not resent.
 */
export const ProductOwners = ({ token, products }: { token: string; products: string[] }) => {
  const query = useQuery({
    queryKey: ["product-owners", token, products],
    queryFn: async () =>
      Object.fromEntries(
        await Promise.all(
          products.map(
            async (product) => [product, await fetchProductRouting(product, token)] as const,
          ),
        ),
      ) as Record<string, Load<ProductRouting>>,
    enabled: products.length > 0,
    retry: false,
  });
  const call = useManagementCall(token, "fleet", "management", describe);
  const [product, setProduct] = useState("");
  const selected = products.includes(product) ? product : (products[0] ?? "");
  const routing = query.data?.[selected];
  const current = routing?.kind === "ok" ? routing.value : undefined;
  if (products.length === 0) {
    return null;
  }
  return (
    <section aria-label="Product owners" className="min-w-0">
      <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Owners</h2>
      <Card className="overflow-x-auto">
        <table aria-label="Product owners" className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className={th}>Product</th>
              <th className={th}>Owner</th>
              <th className={th}>Endpoints</th>
            </tr>
          </thead>
          <tbody>
            {products.map((name) => {
              const load = query.data?.[name];
              return (
                <tr key={name} className="[&:last-child>td]:border-b-0">
                  <td className={`${td} font-semibold`}>{name}</td>
                  {load === undefined ? (
                    <td colSpan={2} className={`${td} text-muted`}>
                      Loading
                    </td>
                  ) : load.kind === "ok" ? (
                    <>
                      <td className={`${td} break-all ${load.value.owner ? "" : "text-muted"}`}>
                        {ownerLine(load.value.owner)}
                      </td>
                      <td className={`${td} font-mono break-all`}>
                        {endpointsLine(load.value.webhooks.map((hook) => hook.url))}
                      </td>
                    </>
                  ) : (
                    <td colSpan={2} className={`${td} text-muted`}>
                      {load.kind === "error" ? load.message : LOAD_TEXT[load.kind]}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {call.allowed && current && (
        <Card className="mt-2 flex flex-wrap items-center gap-2 px-3.5 py-3 text-xs">
          {products.length > 1 && (
            <select
              aria-label="Owner product"
              value={selected}
              onChange={(event) => setProduct(event.target.value)}
              className={field}
            >
              {products.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <ProductForms
            key={selected}
            product={selected}
            routing={current}
            pending={call.isPending}
            send={(path, method, body) =>
              call.mutate({ path, method, ...(body === undefined ? {} : { body }) })
            }
          />
        </Card>
      )}
      {call.outcome && (
        <div className="mt-2">
          <Notice tone={call.outcome.tone}>{call.outcome.text}</Notice>
        </div>
      )}
    </section>
  );
};

const ProductForms = ({
  product,
  routing,
  pending,
  send,
}: {
  product: string;
  routing: ProductRouting;
  pending: boolean;
  send: (path: string, method: "PUT" | "DELETE", body?: unknown) => void;
}) => {
  const [contact, setContact] = useState(routing.owner?.contact ?? "");
  const [url, setUrl] = useState("");
  const [secretEnv, setSecretEnv] = useState("");
  const [events, setEvents] = useState<WebhookEvent[]>(APPLY_EVENTS);
  // Fields this page does not edit ride along unchanged when an endpoint is saved.
  const [kept, setKept] = useState<Pick<WebhookEndpoint, "operational" | "feedback">>({});
  const load = (hook: WebhookEndpoint) => {
    setUrl(hook.url);
    setSecretEnv(hook.secret_env);
    // No listed event of any kind means every apply outcome, as the server reads it.
    const listsNone = [hook.events, hook.operational, hook.feedback].every(
      (list) => (list ?? []).length === 0,
    );
    setEvents(listsNone ? APPLY_EVENTS : (hook.events ?? []));
    setKept({
      ...(hook.operational === undefined ? {} : { operational: hook.operational }),
      ...(hook.feedback === undefined ? {} : { feedback: hook.feedback }),
    });
  };
  const configured = routing.webhooks.some((hook) => hook.url === url.trim());
  const nothing =
    events.length === 0 &&
    (kept.operational ?? []).length === 0 &&
    (kept.feedback ?? []).length === 0;
  return (
    <>
      <div className="flex w-full flex-wrap items-center gap-2">
        <input
          aria-label="Product owner contact"
          placeholder="Owner contact"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
          className={`${field} flex-1`}
        />
        <ConfirmButton
          label="Set owner"
          confirm={`Set ${product} owner ${contact.trim()}`}
          disabled={pending || !contact.trim()}
          onConfirm={() => send(productPath(product, "owner"), "PUT", setOwnerBody(contact))}
        />
        {routing.owner && (
          <ConfirmButton
            label="Clear owner"
            confirm={`Clear ${product} owner`}
            disabled={pending}
            onConfirm={() => send(productPath(product, "owner"), "DELETE")}
          />
        )}
      </div>
      {routing.webhooks.length > 0 && (
        <div className="flex w-full flex-wrap gap-1.5">
          {routing.webhooks.map((hook) => (
            <Button key={hook.url} variant="ghost" onClick={() => load(hook)}>
              {hook.url}
            </Button>
          ))}
        </div>
      )}
      <input
        aria-label="Product webhook URL"
        placeholder="Webhook URL"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        className={`${field} flex-1`}
      />
      <input
        aria-label="Product secret variable"
        placeholder="Secret variable"
        value={secretEnv}
        onChange={(event) => setSecretEnv(event.target.value)}
        className={field}
      />
      <div role="group" aria-label="Product events" className="flex w-full flex-wrap gap-2">
        {APPLY_EVENTS.map((event) => (
          <label key={event} className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={events.includes(event)}
              onChange={(change) =>
                setEvents(
                  change.target.checked
                    ? [...events.filter((item) => item !== event), event]
                    : events.filter((item) => item !== event),
                )
              }
            />
            {event}
          </label>
        ))}
      </div>
      <ConfirmButton
        label={configured ? "Save webhook" : "Add webhook"}
        confirm={`${configured ? "Save" : "Add"} ${product} webhook ${url.trim()}`}
        disabled={pending || !url.trim() || !secretEnv.trim() || nothing}
        onConfirm={() =>
          send(productPath(product, "webhooks"), "PUT", {
            url: url.trim(),
            secret_env: secretEnv.trim(),
            events,
            ...kept,
          } satisfies WebhookEndpoint)
        }
      />
      {routing.webhooks.length > 0 && (
        <ConfirmButton
          label="Remove all webhooks"
          confirm={`Remove all ${routing.webhooks.length} ${product} webhooks`}
          disabled={pending}
          onConfirm={() => send(productPath(product, "webhooks"), "DELETE")}
        />
      )}
    </>
  );
};

export default ProductOwners;
