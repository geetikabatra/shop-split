/**
 * Plan definitions and limit logic. Deliberately NOT a .server.ts file:
 * everything here is pure (no Prisma, no Node APIs), and route components
 * need to reference it directly (e.g. displaying the plan name/limit in
 * JSX) -- React Router treats every export of a .server file as
 * server-only and refuses to bundle it for the client, even a plain
 * string constant.
 */
export const GROWTH_PLAN = "Growth";

/**
 * Limit on non-COMPLETED experiments (see countActiveExperiments in
 * experiment.server.ts), keyed by plan name as it comes back from
 * billing.check()/appSubscriptions. null means unlimited. A shop with no
 * active subscription is on the implicit free tier.
 */
export const PLAN_LIMITS: Record<string, number | null> = {
  [GROWTH_PLAN]: null,
};

export const FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT = 1;

export function getMaxActiveExperiments(planName: string | null): number | null {
  if (!planName) return FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT;
  return planName in PLAN_LIMITS ? PLAN_LIMITS[planName] : FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT;
}
