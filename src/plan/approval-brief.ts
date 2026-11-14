import { type } from "arktype";
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";

// The approval brief Tenkai computes at planning and covers with the plan
// digest: who proposed the plan, its blast radius, flagged risky changes,
// attached evidence, and what policy would do without a human. Inspect's
// `latest_plan.approval_brief` carries it; older servers and older plans omit it.
//
// Server data is validated here, not trusted: a malformed brief reads as
// missing rather than half rendered.

const Brief = type({
  proposer: "string",
  "actor_chain?": type({ id: "string", kind: "string", "+": "delete" }).array(),
  blast_radius: {
    environment: "string",
    instances: "string[]",
    "criticality?": "string",
    rollback_available: "boolean",
    "+": "delete",
  },
  changes: {
    "counts?": "Record<string, number>",
    "risky?": "string[]",
    "+": "delete",
  },
  "evidence?": "string[]",
  policy: {
    without_human: "string",
    budget: "string",
    "reason?": "string",
    "+": "delete",
  },
  "+": "delete",
});

/** Rows the brief renders before it counts the rest. */
export const BRIEF_LIMITS = { risky: 20, instances: 8 } as const;

export const BRIEF_COPY = {
  missing: "No approval brief for this plan",
  noRisk: "none flagged",
  noEvidence: "none attached",
  agent: "agent proposed",
  auto: "auto",
  human: "needs a human",
  over: "over agent budget",
  inside: "inside agent budget",
  rollback: "rollback available",
  noRollback: "no rollback",
  more: (count: number) => `${count} more`,
} as const;

/** Fixed risky-change codes from Tenkai's documented list. */
const RISKY: Record<string, string> = {
  deleted_volume: "deleted volume",
  changed_ports: "changed ports",
  widened_grant: "widened grant",
};

export type RiskyChange = { label: string; subject: string };

export type BriefView = {
  risky: RiskyChange[];
  riskyHidden: number;
  proposer: string;
  /** The first agent in the actor chain; the proposer is the delegating user. */
  agent: string | undefined;
  /** Every delegating actor, outermost first. */
  chain: string[];
  withoutHuman: string;
  /** Absent when no agent budget applies (`not_configured`). */
  budget: { text: string; over: boolean } | undefined;
  environment: string;
  instances: string[];
  instancesHidden: number;
  criticality: string | undefined;
  rollback: boolean;
  counts: string;
  evidence: string[];
};

/** `deleted_volume:Deployment api` reads as `deleted volume` on `Deployment api`. */
export const riskyChange = (raw: string): RiskyChange => {
  const colon = raw.indexOf(":");
  const code = colon < 0 ? raw : raw.slice(0, colon);
  const subject = colon < 0 ? "" : raw.slice(colon + 1);
  return { label: RISKY[code] ?? code.replaceAll("_", " "), subject };
};

const budgetView = (budget: string): BriefView["budget"] => {
  if (budget === "not_configured") {
    return undefined;
  }
  if (budget === "over") {
    return { text: BRIEF_COPY.over, over: true };
  }
  if (budget === "inside") {
    return { text: BRIEF_COPY.inside, over: false };
  }
  return { text: budget, over: false };
};

/** The brief as rows to render, or undefined when the plan carries none. */
export const briefView = (
  plan: EnvironmentPlanSummary | null | undefined,
): BriefView | undefined => {
  const brief = Brief(plan?.approval_brief);
  if (brief instanceof type.errors) {
    return undefined;
  }
  const chain = brief.actor_chain ?? [];
  const agent = chain.find((actor) => actor.kind === "agent")?.id;
  const risky = brief.changes.risky ?? [];
  const instances = brief.blast_radius.instances;
  const { without_human: withoutHuman, reason } = brief.policy;
  return {
    risky: risky.slice(0, BRIEF_LIMITS.risky).map(riskyChange),
    riskyHidden: Math.max(0, risky.length - BRIEF_LIMITS.risky),
    proposer: brief.proposer,
    agent,
    chain: chain.map((actor) => `${actor.id} ${actor.kind}`),
    withoutHuman:
      withoutHuman === "auto"
        ? BRIEF_COPY.auto
        : withoutHuman === "require_human"
          ? reason
            ? `${BRIEF_COPY.human}: ${reason}`
            : BRIEF_COPY.human
          : withoutHuman,
    budget: budgetView(brief.policy.budget),
    environment: brief.blast_radius.environment,
    instances: instances.slice(0, BRIEF_LIMITS.instances),
    instancesHidden: Math.max(0, instances.length - BRIEF_LIMITS.instances),
    criticality: brief.blast_radius.criticality,
    rollback: brief.blast_radius.rollback_available,
    counts: Object.entries(brief.changes.counts ?? {})
      .map(([kind, count]) => `${kind} ${count}`)
      .join(", "),
    evidence: brief.evidence ?? [],
  };
};
