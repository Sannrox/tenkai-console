import { describe, expect, it } from "vitest";
import type { MigrationDeclaration, MigrationRecord } from "../api/tenkai.gen";
import {
  applyBody,
  checkpointRows,
  describeMigration,
  listMigrations,
  migrationsPath,
  mutateBody,
  parseDeclaration,
  parseGeneration,
  parseMigrationEvidence,
  parsePlanApproval,
  pinLine,
  previewBody,
  shortPlan,
} from "./migrations";

const declaration: MigrationDeclaration = {
  version: 1,
  profile: "tenkai.package_migration.v1",
  source: { product: "pkg", version: "1.0.0", digest: "sha256:aa" },
  target: { product: "pkg", version: "1.1.0", digest: "sha256:bb" },
  compatibility: { version: 1, status: "compatible", evidence_digest: "sha256:ev" },
  checkpoints: [
    { id: "preflight", class: "reversible" },
    { id: "switch", class: "compensating" },
    { id: "drop-old", class: "irreversible", pre_admission: "require_backup_receipt" },
  ],
};

const declarationText = JSON.stringify(declaration);

const approval = (environment: string) =>
  JSON.stringify({
    schema: "tenkai.package-migration-approval.v1",
    key_id: "ops-1",
    signature: "c2ln",
    statement: {
      identity_digest: "sha256:id",
      environment,
      purpose: "package_migration",
      issued_at: 1,
      expires_at: 2,
    },
  });

const roots = 'version = 1\n\n[[signers]]\nkey_id = "ops-1"\nidentity = "ops"\npublic_key = "k"\n';

const planApproval = JSON.stringify({
  schema: "tenkai.plan-approval.v1",
  key_id: "ops-1",
  signature: "c2ln",
  statement: {
    environment: "prod",
    expires_at: 2,
    issued_at: 1,
    plan_digest: "sha256:abc",
    policy_digest: "sha256:def",
    policy_evidence_id: "ev-1",
    policy_provider: "tenkai",
    purpose: "apply",
    skip_gates: false,
  },
});

const record = (over: Partial<MigrationRecord> = {}): MigrationRecord => ({
  name: "cutover",
  environment: "prod",
  identity_digest: "sha256:id",
  declaration,
  approval_digest: "sha256:cc",
  fence_generation: 4,
  status: "running",
  receipts: [
    {
      checkpoint_id: "preflight",
      class: "reversible",
      effect: "revalidate",
      result: "accepted",
      fence_generation: 4,
    },
  ],
  ...over,
});

describe("migration requests", () => {
  it("parses the declaration and names pins as product@version digest", () => {
    expect(parseDeclaration(declarationText)).toEqual(declaration);
    expect(pinLine(declaration.source)).toBe("pkg@1.0.0 sha256:aa");
    expect(parseDeclaration("{")).toMatch(/^The declaration must be/);
    expect(parseDeclaration(JSON.stringify({ version: 1 }))).toMatch(/^Declaration:/);
  });

  it("refuses malformed or misdirected migration approval before sending", () => {
    expect(parseMigrationEvidence("prod", "{", roots)).toMatch(/^The approval must be/);
    expect(parseMigrationEvidence("prod", approval("prod"), "= nope")).toMatch(
      /^Trust roots must be/,
    );
    expect(parseMigrationEvidence("prod", approval("staging"), roots)).toBe(
      "This approval is for staging, not prod.",
    );
    expect(parseMigrationEvidence("prod", JSON.stringify({ schema: "x" }), roots)).toMatch(
      /^Approval envelope:/,
    );
    expect(parsePlanApproval("{")).toMatch(/^The plan approval must be/);
    expect(parsePlanApproval(JSON.stringify({ schema: "x" }))).toMatch(/^Plan approval:/);
  });

  it("builds versioned bodies without development bypasses", () => {
    const evidence = parseMigrationEvidence("prod", approval("prod"), roots);
    if (typeof evidence === "string") {
      throw new Error(evidence);
    }
    const plan = parsePlanApproval(planApproval);
    if (typeof plan === "string") {
      throw new Error(plan);
    }
    expect(previewBody("prod", declaration, "sha256:dd")).toEqual({
      version: 1,
      environment: "prod",
      declaration,
      backup_receipt_digest: "sha256:dd",
    });
    expect(previewBody("prod", declaration, "  ")).not.toHaveProperty("backup_receipt_digest");
    const apply = applyBody("prod", 0, declaration, evidence, "", "tenkai:plan:pln-41", plan);
    expect(apply).toMatchObject({
      version: 1,
      environment: "prod",
      expected_generation: 0,
      plan_approvals: { "tenkai:plan:pln-41": { key_id: "ops-1" } },
    });
    expect(apply).not.toHaveProperty("allow_unapproved_development");
    expect(apply).not.toHaveProperty("operation");
    expect(mutateBody(4, evidence, undefined, undefined)).toEqual({
      version: 1,
      expected_generation: 4,
      approval: evidence.approval,
      trust_roots: evidence.trust_roots,
    });
  });

  it("treats an empty generation as 0 and rejects other text", () => {
    expect(parseGeneration("")).toBe(0);
    expect(parseGeneration("4")).toBe(4);
    expect(parseGeneration(" 4 ")).toBe(4);
    expect(parseGeneration("1.5")).toBe("Generation must be a whole number.");
    expect(parseGeneration("-1")).toBe("Generation must be a whole number.");
  });
});

describe("migration status", () => {
  it("shows receipt results and the waiting compensating plan in declaration order", () => {
    const running = record({ pending_plan_id: "tenkai:plan:pln-41" });
    expect(checkpointRows(running)).toEqual([
      { id: "preflight", class: "reversible", result: "accepted", waiting: false },
      { id: "switch", class: "compensating", result: "waiting plan pln-41", waiting: true },
      { id: "drop-old", class: "irreversible", result: "not started", waiting: false },
    ]);
    expect(describeMigration({ version: 1, record: running })).toBe(
      "cutover running, pending plan pln-41",
    );
    expect(shortPlan("tenkai:plan:pln-41")).toBe("pln-41");
    expect(
      checkpointRows(
        record({
          pending_rollback_plan_id: "tenkai:plan:pln-9",
          receipts: [
            {
              checkpoint_id: "preflight",
              class: "reversible",
              effect: "revalidate",
              result: "accepted",
              fence_generation: 4,
            },
            {
              checkpoint_id: "switch",
              class: "compensating",
              effect: "apply_target",
              result: "accepted",
              fence_generation: 4,
            },
          ],
        }),
      ),
    ).toEqual([
      { id: "preflight", class: "reversible", result: "accepted", waiting: false },
      { id: "switch", class: "compensating", result: "waiting plan pln-9", waiting: true },
      { id: "drop-old", class: "irreversible", result: "not started", waiting: false },
    ]);
  });
});

describe("migration list pages", () => {
  it("walks next_cursor and stops when the server omits it", async () => {
    expect(migrationsPath()).toBe("v1/migrations?limit=100");
    expect(migrationsPath("abc")).toBe("v1/migrations?limit=100&cursor=abc");
    const pages = [
      {
        items: [{ id: "1", name: "cutover", environment: "prod", status: "running" as const }],
        next_cursor: "1",
      },
      {
        items: [{ id: "2", name: "ledger", environment: "prod", status: "succeeded" as const }],
      },
    ];
    let calls = 0;
    const items = await listMigrations("t-1", (input) => {
      if (!(input instanceof URL)) {
        throw new Error("expected URL");
      }
      const page = pages[calls];
      if (!page) {
        throw new Error("unexpected extra list page");
      }
      calls += 1;
      expect(input.href).toContain(calls === 1 ? "limit=100" : "cursor=1");
      return Promise.resolve(new Response(JSON.stringify(page), { status: 200 }));
    });
    expect(items.map((item) => item.name)).toEqual(["cutover", "ledger"]);
    expect(calls).toBe(2);
  });
});
