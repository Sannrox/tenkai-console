import { describe, expect, it, vi } from "vitest";
import {
  COPY,
  DAY_MS,
  DEFAULT_PERIOD_DAYS,
  channelLine,
  deployFigure,
  exposureFigure,
  failureFigure,
  fetchReport,
  historySearch,
  leadFigure,
  parseReport,
  periodLine,
  rateLine,
  reportPath,
  reportQuery,
  restoreFigure,
} from "./delivery-report";

const SINCE = Date.parse("2026-10-22T00:00:00.000Z");
const UNTIL = Date.parse("2026-11-21T00:00:00.000Z");

const ROW = {
  product: "api",
  channel: "stable",
  deployments: 12,
  change_attempts: 12,
  change_failures: 1,
  change_failure_rate: 0.083,
  lead_time_ms: 4 * 60 * 60 * 1000,
  restores: 1,
  unrestored: 0,
  time_to_restore_ms: 2 * 60 * 60 * 1000,
  open_exposures: 3,
  oldest_exposure_age_ms: 5 * 24 * 60 * 60 * 1000,
};

const REPORT = {
  environment: "prod",
  since_ms: SINCE,
  until_ms: UNTIL,
  missing_data: false,
  rows: [ROW],
};

const answering = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status }));

const hrefOf = (called: unknown): string =>
  called instanceof URL ? called.href : called instanceof Request ? called.url : "";

describe("reportPath", () => {
  it("encodes the environment and omits the server default period", () => {
    expect(reportPath("prod")).toBe("v1/environments/prod/delivery-report");
    expect(reportPath("a/b", { since_ms: 1, until_ms: 2 })).toBe(
      "v1/environments/a%2Fb/delivery-report?since_ms=1&until_ms=2",
    );
    expect(reportQuery(DEFAULT_PERIOD_DAYS, UNTIL)).toEqual({});
    expect(reportQuery(7, UNTIL)).toEqual({ since_ms: UNTIL - 7 * DAY_MS });
  });
});

describe("parseReport", () => {
  it("accepts a recorded report and unknown fields", () => {
    const parsed = parseReport({
      ...REPORT,
      extra: "ignored",
      rows: [{ ...ROW, extra: "ignored" }],
    });
    expect(parsed).toMatchObject({
      environment: "prod",
      missing_data: false,
      rows: [{ product: "api", deployments: 12, channel: "stable" }],
    });
  });

  it("rejects a body that is not a report", () => {
    expect(parseReport({ environment: "prod" })).toBeUndefined();
    expect(parseReport({ ...REPORT, rows: [{ product: "api" }] })).toBeUndefined();
  });
});

describe("fetchReport", () => {
  it("reads the report from its encoded route", async () => {
    const fetch = answering(200, REPORT);
    const load = await fetchReport("a/b", "t", { since_ms: 1, until_ms: 2 }, fetch);
    expect(load).toEqual({ kind: "ok", value: parseReport(REPORT) });
    expect(hrefOf(fetch.mock.calls[0]?.[0])).toMatch(
      /\/v1\/environments\/a%2Fb\/delivery-report\?since_ms=1&until_ms=2$/,
    );
  });

  it("names no permission, no route, and a refused empty period", async () => {
    expect(await fetchReport("prod", "t", {}, answering(403, { error: "no" }))).toEqual({
      kind: "forbidden",
    });
    expect(await fetchReport("prod", "t", {}, answering(404, { error: "no" }))).toEqual({
      kind: "unavailable",
    });
    expect(await fetchReport("prod", "t", {}, answering(405, { error: "no" }))).toEqual({
      kind: "unavailable",
    });
    expect(
      await fetchReport(
        "prod",
        "t",
        {},
        answering(400, { error: "delivery report period is empty" }),
      ),
    ).toEqual({ kind: "error", message: "delivery report period is empty" });
    expect(await fetchReport("prod", "t", {}, answering(500, null))).toEqual({
      kind: "error",
      message: "Could not load",
    });
    expect(await fetchReport("prod", "t", {}, answering(200, { items: [] }))).toEqual({
      kind: "error",
      message: "Could not load",
    });
  });
});

describe("figures", () => {
  it("names the period, rate, channel, and backing counts", () => {
    expect(periodLine(SINCE, UNTIL)).toBe("2026-10-22T00:00:00.000Z to 2026-11-21T00:00:00.000Z");
    expect(rateLine(0.083)).toBe("8.3%");
    expect(channelLine("stable")).toBe("stable");
    expect(channelLine(undefined)).toBe(COPY.empty);
    expect(deployFigure(ROW)).toEqual({ value: "12", count: "12 records" });
    expect(failureFigure(ROW)).toEqual({ value: "8.3%", count: "1 of 12" });
    expect(leadFigure(ROW)).toEqual({ value: "4h", count: "12 records" });
    expect(restoreFigure(ROW)).toEqual({
      value: "2h",
      count: "1 restored · 0 unrestored",
    });
    expect(exposureFigure(ROW)).toEqual({ value: "5d", count: "3 open" });
    expect(historySearch("prod", "api")).toEqual({ instance: "api" });
  });

  it("omits rates, times, and ages that have no records", () => {
    const empty = {
      product: "api",
      deployments: 0,
      change_attempts: 0,
      change_failures: 0,
      restores: 0,
      unrestored: 0,
      open_exposures: 0,
    };
    expect(failureFigure(empty)).toBeUndefined();
    expect(leadFigure(empty)).toBeUndefined();
    expect(restoreFigure(empty)).toBeUndefined();
    expect(exposureFigure(empty)).toBeUndefined();
    expect(deployFigure(empty)).toEqual({ value: "0", count: "0 records" });
    expect(failureFigure({ ...empty, change_attempts: 4, change_failure_rate: 0 })).toEqual({
      value: "0.0%",
      count: "0 of 4",
    });
    expect(restoreFigure({ ...empty, unrestored: 1 })).toEqual({
      value: "0 restored · 1 unrestored",
      count: "0 restored · 1 unrestored",
    });
  });
});
