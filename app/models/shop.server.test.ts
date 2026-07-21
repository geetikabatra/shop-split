import { describe, expect, it } from "vitest";
import prisma from "../db.server";
import { createExperiment, transitionExperimentStatus } from "./experiment.server";
import { createVariant } from "./variant.server";
import { recordEvent } from "./event.server";
import { createTestShop } from "./test-helpers.server";

// Exercises the actual cascade-delete chain the shop/redact webhook
// relies on (see app/routes/webhooks.shop.redact.tsx). The webhook route
// itself just calls db.shop.deleteMany() -- this is what verifies that
// call really does purge everything, since a schema relation missing
// onDelete: Cascade would silently leave orphaned rows instead of erroring.
describe("deleting a Shop cascades to all its data", () => {
  it("purges Experiment, Variant, Assignment, and Event rows", async () => {
    const shop = await createTestShop();

    const experiment = await createExperiment(shop.id, {
      name: "To be redacted",
      targetType: "PRODUCT_PAGE",
      goal: "PURCHASE",
    });
    const control = await createVariant(shop.id, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });
    await createVariant(shop.id, experiment.id, {
      name: "B",
      isControl: false,
      weight: 0,
      content: "{}",
    });
    await transitionExperimentStatus(shop.id, experiment.id, "RUNNING");
    await recordEvent(shop.id, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "v1",
      type: "IMPRESSION",
    });

    await prisma.shop.delete({ where: { id: shop.id } });

    expect(await prisma.experiment.count({ where: { shopId: shop.id } })).toBe(0);
    expect(await prisma.variant.count({ where: { experimentId: experiment.id } })).toBe(0);
    expect(await prisma.assignment.count({ where: { experimentId: experiment.id } })).toBe(0);
    expect(await prisma.event.count({ where: { experimentId: experiment.id } })).toBe(0);
  });
});
