import prisma from "../db.server";
import { getExperiment } from "./experiment.server";
import { twoProportionZTest, type ZTestResult } from "../utils/stats.server";

export interface VariantResult {
  variantId: string;
  name: string;
  isControl: boolean;
  weight: number;
  visitors: number;
  conversions: number;
  /** 0..1; 0 when there are no visitors yet, never NaN. */
  conversionRate: number;
  revenue: number;
  /** 0 when there are no visitors yet, never NaN. */
  revenuePerVisitor: number;
  /** null for the control itself, or when there isn't enough data yet. */
  vsControl: ZTestResult | null;
}

export interface ExperimentResults {
  experimentId: string;
  goal: string;
  variants: VariantResult[];
}

/**
 * Aggregates Assignment/Event rows into per-variant conversion rate,
 * revenue, and statistical significance vs the control variant.
 *
 * "Visitors" is the count of Assignment rows (unique bucketed visitors),
 * not raw IMPRESSION events, since a visitor can generate multiple
 * impressions across page views. "Conversions" is the count of *distinct*
 * assignments with at least one event matching the experiment's goal, for
 * the same reason -- a visitor who adds to cart twice is one conversion,
 * not two. Revenue sums every PURCHASE event's orderValue without
 * deduping, since each completed order is real revenue even if the same
 * visitor purchased more than once.
 */
export async function computeExperimentResults(
  shopId: string,
  experimentId: string,
): Promise<ExperimentResults> {
  const experiment = await getExperiment(shopId, experimentId);

  const [assignmentCounts, conversionEvents, revenueEvents] = await Promise.all([
    prisma.assignment.groupBy({
      by: ["variantId"],
      where: { experimentId },
      _count: { _all: true },
    }),
    prisma.event.findMany({
      where: { experimentId, type: experiment.goal, assignmentId: { not: null } },
      select: { variantId: true, assignmentId: true },
    }),
    prisma.event.findMany({
      where: { experimentId, type: "PURCHASE" },
      select: { variantId: true, orderValue: true },
    }),
  ]);

  const visitorsByVariant = new Map(
    assignmentCounts.map((row) => [row.variantId, row._count._all]),
  );

  const convertedAssignmentsByVariant = new Map<string, Set<string>>();
  for (const event of conversionEvents) {
    if (!event.assignmentId) continue;
    const set = convertedAssignmentsByVariant.get(event.variantId) ?? new Set<string>();
    set.add(event.assignmentId);
    convertedAssignmentsByVariant.set(event.variantId, set);
  }

  const revenueByVariant = new Map<string, number>();
  for (const event of revenueEvents) {
    revenueByVariant.set(
      event.variantId,
      (revenueByVariant.get(event.variantId) ?? 0) + (event.orderValue ?? 0),
    );
  }

  const stats = experiment.variants.map((variant) => {
    const visitors = visitorsByVariant.get(variant.id) ?? 0;
    const conversions = convertedAssignmentsByVariant.get(variant.id)?.size ?? 0;
    const revenue = revenueByVariant.get(variant.id) ?? 0;

    return {
      variantId: variant.id,
      name: variant.name,
      isControl: variant.isControl,
      weight: variant.weight,
      visitors,
      conversions,
      conversionRate: visitors > 0 ? conversions / visitors : 0,
      revenue,
      revenuePerVisitor: visitors > 0 ? revenue / visitors : 0,
    };
  });

  const control = stats.find((v) => v.isControl);

  const variants: VariantResult[] = stats.map((variant) => ({
    ...variant,
    vsControl:
      control && !variant.isControl
        ? twoProportionZTest(control.conversions, control.visitors, variant.conversions, variant.visitors)
        : null,
  }));

  return { experimentId, goal: experiment.goal, variants };
}
