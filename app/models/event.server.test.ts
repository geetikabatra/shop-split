import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExperiment, transitionExperimentStatus } from "./experiment.server";
import { createVariant } from "./variant.server";
import { EventError, recordEvent } from "./event.server";
import { cleanupShop, createTestShop } from "./test-helpers.server";
import prisma from "../db.server";

async function createRunningExperiment(shopId: string) {
  const experiment = await createExperiment(shopId, {
    name: "Event tests",
    targetType: "PRODUCT_PAGE",
    goal: "PURCHASE",
  });
  const control = await createVariant(shopId, experiment.id, {
    name: "Control",
    isControl: true,
    weight: 50,
    content: "{}",
  });
  const treatment = await createVariant(shopId, experiment.id, {
    name: "Treatment",
    isControl: false,
    weight: 50,
    content: "{}",
  });
  await transitionExperimentStatus(shopId, experiment.id, "RUNNING");
  return { experimentId: experiment.id, control, treatment };
}

describe("recordEvent", () => {
  let shopId: string;

  beforeEach(async () => {
    shopId = (await createTestShop()).id;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("records an impression and creates a sticky assignment", async () => {
    const { experimentId, control } = await createRunningExperiment(shopId);

    await recordEvent(shopId, {
      experimentId,
      variantId: control.id,
      visitorId: "visitor-1",
      type: "IMPRESSION",
    });

    const assignment = await prisma.assignment.findUnique({
      where: { experimentId_visitorId: { experimentId, visitorId: "visitor-1" } },
    });
    expect(assignment?.variantId).toBe(control.id);

    const events = await prisma.event.findMany({ where: { experimentId } });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("IMPRESSION");
  });

  it("keeps the original assignment even if a later event reports a different variant", async () => {
    const { experimentId, control, treatment } = await createRunningExperiment(shopId);

    await recordEvent(shopId, {
      experimentId,
      variantId: control.id,
      visitorId: "visitor-1",
      type: "IMPRESSION",
    });
    // Simulates a stale client sending the "wrong" variant for a visitor
    // who was already assigned to control.
    await recordEvent(shopId, {
      experimentId,
      variantId: treatment.id,
      visitorId: "visitor-1",
      type: "ADD_TO_CART",
    });

    const events = await prisma.event.findMany({ where: { experimentId }, orderBy: { createdAt: "asc" } });
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.variantId === control.id)).toBe(true);
  });

  it("rejects an event for a variant that doesn't belong to the experiment", async () => {
    const { experimentId } = await createRunningExperiment(shopId);
    const other = await createRunningExperiment(shopId);

    await expect(
      recordEvent(shopId, {
        experimentId,
        variantId: other.control.id,
        visitorId: "visitor-1",
        type: "IMPRESSION",
      }),
    ).rejects.toThrow(EventError);
  });

  it("rejects IMPRESSION/ADD_TO_CART for a non-running experiment", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Still draft",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const control = await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });

    await expect(
      recordEvent(shopId, {
        experimentId: experiment.id,
        variantId: control.id,
        visitorId: "visitor-1",
        type: "IMPRESSION",
      }),
    ).rejects.toThrow(/not in an eligible status/);
  });

  it("allows PURCHASE for a paused or completed experiment", async () => {
    const { experimentId, control } = await createRunningExperiment(shopId);
    await transitionExperimentStatus(shopId, experimentId, "PAUSED");

    await expect(
      recordEvent(shopId, {
        experimentId,
        variantId: control.id,
        visitorId: "visitor-1",
        type: "PURCHASE",
        orderId: "order-1",
        orderValue: 42,
      }),
    ).resolves.not.toThrow();
  });

  it("is idempotent on duplicate purchase webhook retries", async () => {
    const { experimentId, control } = await createRunningExperiment(shopId);

    const input = {
      experimentId,
      variantId: control.id,
      visitorId: "visitor-1",
      type: "PURCHASE" as const,
      orderId: "order-1",
      orderValue: 42,
    };
    await recordEvent(shopId, input);
    const second = await recordEvent(shopId, input);

    expect(second).toBeNull();
    const purchaseEvents = await prisma.event.findMany({
      where: { experimentId, type: "PURCHASE" },
    });
    expect(purchaseEvents).toHaveLength(1);
  });
});
