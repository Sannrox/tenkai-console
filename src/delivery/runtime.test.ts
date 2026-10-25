import { describe, expect, it } from "vitest";
import type { EnvironmentRuntimeReport, ObservedRuntimeComponent } from "../api/tenkai.gen";
import { initJobLine, modelLine, runtimeRows, unitLine } from "./runtime";

const DIGEST_A = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const DIGEST_B = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const docker = (): ObservedRuntimeComponent => ({
  product: "edge-app",
  executor_kind: "docker",
  health: "healthy",
  units: [
    {
      name: "api",
      image_digest: DIGEST_B,
      restart_policy: "unless-stopped",
      running: true,
      health: "healthy",
    },
    {
      name: "worker",
      image_digest: DIGEST_B,
      restart_policy: "on-failure:3",
      running: false,
    },
  ],
  last_init_job: { name: "init", status: "exited", exit_code: 0 },
});

const model = (): ObservedRuntimeComponent => ({
  product: "qwen",
  executor_kind: "model_runtime",
  health: "healthy",
  model_runtime: {
    variant: "qwen@1.0.0",
    accelerator: "nvidia",
    verified_weight_digest: DIGEST_A,
  },
});

const report = (...components: ObservedRuntimeComponent[]): EnvironmentRuntimeReport => ({
  environment: "stage",
  components,
});

describe("unitLine", () => {
  it("names digest, running, health, and restart policy", () => {
    expect(unitLine(docker().units![0]!)).toBe(`api ${DIGEST_B} running healthy unless-stopped`);
    expect(unitLine(docker().units![1]!)).toBe(`worker ${DIGEST_B} stopped on-failure:3`);
  });
});

describe("initJobLine", () => {
  it("includes the exit code only when the server sent one", () => {
    expect(initJobLine(docker().last_init_job)).toBe("init exited 0");
    expect(initJobLine({ name: "init", status: "absent" })).toBe("init absent");
    expect(initJobLine(undefined)).toBe("none");
  });
});

describe("modelLine", () => {
  it("names variant, accelerator fit, and verified weight digest", () => {
    expect(modelLine(model().model_runtime)).toBe(`qwen@1.0.0 nvidia ${DIGEST_A}`);
    expect(modelLine({ variant: "qwen@1.0.0", verified_weight_digest: DIGEST_A })).toBe(
      `qwen@1.0.0 ${DIGEST_A}`,
    );
    expect(modelLine(undefined)).toBe("none");
  });
});

describe("runtimeRows", () => {
  it("orders products and labels docker units, init, and model runtime", () => {
    const rows = runtimeRows(report(model(), docker()));
    expect(rows.map((row) => row.product)).toEqual(["edge-app", "qwen"]);
    expect(rows[0]).toMatchObject({
      executor: "docker",
      health: "healthy",
      healthTone: "ok",
      init: "init exited 0",
      model: "none",
    });
    expect(rows[0]?.units).toContain(`api ${DIGEST_B} running healthy unless-stopped`);
    expect(rows[0]?.units).toContain(`worker ${DIGEST_B} stopped on-failure:3`);
    expect(rows[1]).toEqual({
      product: "qwen",
      executor: "model_runtime",
      health: "healthy",
      healthTone: "ok",
      units: "none",
      init: "none",
      model: `qwen@1.0.0 nvidia ${DIGEST_A}`,
    });
  });

  it("treats omitted optionals as none and unknown health as a warning", () => {
    expect(
      runtimeRows(report({ product: "edge-app", executor_kind: "docker", health: "unknown" })),
    ).toEqual([
      {
        product: "edge-app",
        executor: "docker",
        health: "unknown",
        healthTone: "warn",
        units: "none",
        init: "none",
        model: "none",
      },
    ]);
    expect(runtimeRows(report())).toEqual([]);
  });
});
