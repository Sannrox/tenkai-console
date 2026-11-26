import { describe, expect, it } from "vitest";
import { canAttachStream, commandFrame, parseControl, streamUrl } from "./debug-stream";

describe("streamUrl", () => {
  it("turns the API root into a websocket path for the session", () => {
    expect(streamUrl("dbg/1", new URL("http://127.0.0.1:8080/"))).toBe(
      "ws://127.0.0.1:8080/v1/debug-sessions/dbg%2F1/stream",
    );
    expect(streamUrl("dbg_1", new URL("https://example.test/prefix/"))).toBe(
      "wss://example.test/prefix/v1/debug-sessions/dbg_1/stream",
    );
  });
});

describe("canAttachStream", () => {
  it("only host identity can upgrade from the browser", () => {
    expect(canAttachStream("")).toBe(true);
    expect(canAttachStream("oidc-access-token")).toBe(false);
  });
});

describe("control frames", () => {
  it("encodes a command and parses attached, exit, and close", () => {
    expect(commandFrame("logs --tail 50")).toBe(
      JSON.stringify({ type: "command", command: "logs --tail 50" }),
    );
    expect(parseControl('{"type":"attached"}')).toEqual({ type: "attached" });
    expect(parseControl('{"type":"exit","code":0}')).toEqual({ type: "exit", code: 0 });
    expect(parseControl('{"type":"close","reason":"bound_reached"}')).toEqual({
      type: "close",
      reason: "bound_reached",
    });
    expect(parseControl("not-json")).toBeUndefined();
  });
});
