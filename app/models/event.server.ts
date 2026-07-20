import { Prisma } from "@prisma/client";
import { z } from "zod";
import prisma from "../db.server";

export const EVENT_TYPES = ["IMPRESSION", "ADD_TO_CART", "PURCHASE"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export class EventError extends Error {}

export const recordEventSchema = z.object({
  experimentId: z.string().min(1),
  variantId: z.string().min(1),
  visitorId: z.string().min(1).max(200),
  type: z.enum(EVENT_TYPES),
  orderId: z.string().min(1).optional(),
  orderValue: z.number().nonnegative().optional(),
});
export type RecordEventInput = z.infer<typeof recordEventSchema>;

/**
 * Single entry point for IMPRESSION, ADD_TO_CART, and PURCHASE events.
 *
 * Assignment is "first write wins": the first event recorded for a given
 * (experiment, visitor) pair fixes the variant via upsert, and every later
 * event for that pair -- even if the caller reports a different variantId --
 * is attributed to that original assignment. This is safe because variants
 * are immutable once an experiment is RUNNING (see experiment.server.ts's
 * state machine), so there's never a legitimate reason for a visitor's
 * variant to change mid-experiment.
 */
export async function recordEvent(shopId: string, input: RecordEventInput) {
  const data = recordEventSchema.parse(input);

  // IMPRESSION/ADD_TO_CART are client-reported and only make sense while an
  // experiment is actively RUNNING. PURCHASE arrives via the orders/paid
  // webhook, often well after add-to-cart -- by checkout time the merchant
  // may have paused or completed the experiment, but the conversion is
  // still legitimately attributable to whichever variant the visitor was
  // assigned when they were bucketed, so it shouldn't be rejected.
  const allowedStatuses: string[] =
    data.type === "PURCHASE" ? ["RUNNING", "PAUSED", "COMPLETED"] : ["RUNNING"];

  const experiment = await prisma.experiment.findFirst({
    where: { id: data.experimentId, shopId, status: { in: allowedStatuses } },
    include: { variants: true },
  });
  if (!experiment) {
    throw new EventError("Experiment not found or not in an eligible status");
  }

  const variant = experiment.variants.find((v) => v.id === data.variantId);
  if (!variant) {
    throw new EventError("Variant does not belong to this experiment");
  }

  const assignment = await prisma.assignment.upsert({
    where: {
      experimentId_visitorId: {
        experimentId: data.experimentId,
        visitorId: data.visitorId,
      },
    },
    update: {},
    create: {
      experimentId: data.experimentId,
      variantId: variant.id,
      visitorId: data.visitorId,
    },
  });

  try {
    return await prisma.event.create({
      data: {
        experimentId: data.experimentId,
        variantId: assignment.variantId,
        assignmentId: assignment.id,
        type: data.type,
        orderId: data.orderId,
        orderValue: data.orderValue,
      },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      // Duplicate (orderId, type): a webhook retry for a purchase we've
      // already recorded. Treat as success rather than erroring.
      return null;
    }
    throw error;
  }
}

/** No in-app job runner; call this from an external cron/scheduler. */
export async function pruneEventsOlderThan(days: number) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return prisma.event.deleteMany({ where: { createdAt: { lt: cutoff } } });
}
