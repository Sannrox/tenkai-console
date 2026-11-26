import { apiRoot } from "../api/http";

/** WebSocket subprotocol both ends must request. */
export const STREAM_PROTOCOL = "tenkai.debug-stream.v1";

export const STREAM_COPY = {
  waiting: "Commands wait until the runtime attaches. Close still works.",
  refused: "no stream: proxy refused the upgrade",
  /** Browsers cannot set Authorization on a WebSocket; only host identity attaches. */
  bearer: "no stream: this sign-in cannot attach from the browser",
} as const;

export const streamUrl = (session: string, root: URL = apiRoot): string => {
  const url = new URL(`v1/debug-sessions/${encodeURIComponent(session)}/stream`, root);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};

/** Empty token is host identity over the socket; a bearer cannot be sent on upgrade. */
export const canAttachStream = (token: string): boolean => token === "";

export type StreamControl =
  | { type: "attached" }
  | { type: "command"; command: string }
  | { type: "exit"; code: number }
  | { type: "close"; reason: string; message?: string };

export const commandFrame = (command: string): string =>
  JSON.stringify({ type: "command", command });

export const parseControl = (text: string): StreamControl | undefined => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null || !("type" in raw)) {
    return undefined;
  }
  const type = raw.type;
  if (type === "attached") {
    return { type: "attached" };
  }
  if (type === "command" && "command" in raw && typeof raw.command === "string") {
    return { type: "command", command: raw.command };
  }
  if (type === "exit" && "code" in raw && typeof raw.code === "number") {
    return { type: "exit", code: raw.code };
  }
  if (type === "close" && "reason" in raw && typeof raw.reason === "string") {
    const message = "message" in raw && typeof raw.message === "string" ? raw.message : undefined;
    return message === undefined
      ? { type: "close", reason: raw.reason }
      : { type: "close", reason: raw.reason, message };
  }
  return undefined;
};

export const decodeBytes = (data: Blob | ArrayBuffer | string): Promise<string> => {
  if (typeof data === "string") {
    return Promise.resolve(data);
  }
  if (data instanceof ArrayBuffer) {
    return Promise.resolve(new TextDecoder().decode(data));
  }
  return data.text();
};
