import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createExperiment, transitionExperimentStatus } from "./experiment.server";
import { createVariant } from "./variant.server";
import { recordEvent } from "./event.server";
import { computeExperimentResults } from "./results.server";
import { cleanupShop, createTestShop } from "./test-helpers.server";

describe("computeExperimentResults", () => {
  let shopId: string;

  beforeEach(async () => {
    shopId = (await createTestShop()).id;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("aggregates visitors, conversions, and revenue per variant", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Results test",
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

    // Control: 3 visitors, 1 purchase ($10).
    for (const visitorId of ["c1", "c2", "c3"]) {
      await recordEvent(shopId, {
        experimentId: experiment.id,
        variantId: control.id,
        visitorId,
        type: "IMPRESSION",
      });
    }
    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "c1",
      type: "PURCHASE",
      orderId: "order-c1",
      orderValue: 10,
    });

    // Treatment: 2 visitors, both purchase ($20 total).
    for (const visitorId of ["t1", "t2"]) {
      await recordEvent(shopId, {
        experimentId: experiment.id,
        variantId: treatment.id,
        visitorId,
        type: "IMPRESSION",
      });
      await recordEvent(shopId, {
        experimentId: experiment.id,
        variantId: treatment.id,
        visitorId,
        type: "PURCHASE",
        orderId: `order-${visitorId}`,
        orderValue: 10,
      });
    }

    const results = await computeExperimentResults(shopId, experiment.id);
    const controlResult = results.variants.find((v) => v.variantId === control.id)!;
    const treatmentResult = results.variants.find((v) => v.variantId === treatment.id)!;

    expect(controlResult.visitors).toBe(3);
    expect(controlResult.conversions).toBe(1);
    expect(controlResult.conversionRate).toBeCloseTo(1 / 3, 10);
    expect(controlResult.revenue).toBe(10);
    expect(controlResult.revenuePerVisitor).toBeCloseTo(10 / 3, 10);

    expect(treatmentResult.visitors).toBe(2);
    expect(treatmentResult.conversions).toBe(2);
    expect(treatmentResult.conversionRate).toBe(1);
    expect(treatmentResult.revenue).toBe(20);
    expect(treatmentResult.revenuePerVisitor).toBe(10);
  });

  it("does not double-count a visitor who converts more than once", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Double conversion test",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const control = await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });
    await createVariant(shopId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 0,
      content: "{}",
    });
    await transitionExperimentStatus(shopId, experiment.id, "RUNNING");

    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "v1",
      type: "IMPRESSION",
    });
    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "v1",
      type: "ADD_TO_CART",
    });
    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "v1",
      type: "ADD_TO_CART",
    });

    const results = await computeExperimentResults(shopId, experiment.id);
    const controlResult = results.variants.find((v) => v.variantId === control.id)!;

    expect(controlResult.visitors).toBe(1);
    expect(controlResult.conversions).toBe(1);
  });

  it("leaves vsControl null when sample sizes are below the significance threshold", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Small sample test",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
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

    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "c1",
      type: "IMPRESSION",
    });
    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: treatment.id,
      visitorId: "t1",
      type: "IMPRESSION",
    });

    const results = await computeExperimentResults(shopId, experiment.id);
    const treatmentResult = results.variants.find((v) => v.variantId === treatment.id)!;

    expect(treatmentResult.vsControl).toBeNull();
  });
});
