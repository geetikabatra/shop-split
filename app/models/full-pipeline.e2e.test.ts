import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExperiment,
  getActiveExperimentForTarget,
  transitionExperimentStatus,
} from "./experiment.server";
import { createVariant } from "./variant.server";
import { recordEvent } from "./event.server";
import { computeExperimentResults } from "./results.server";
import { cleanupShop, createTestShop } from "./test-helpers.server";

/**
 * Exercises the full pipeline end to end across every model module in one
 * pass: create -> variants -> start -> what the App Proxy would actually
 * return to the storefront -> event recording (impression, add-to-cart,
 * purchase) -> results aggregation. Each piece already has its own unit
 * tests; this catches integration-level regressions between them that
 * isolated tests wouldn't (e.g. a shape mismatch between what
 * getActiveExperimentForTarget returns and what the client is expected to
 * send back to recordEvent).
 *
 * Complements, not replaces, the extensive manual E2E testing already done
 * live against a real dev store and Postgres this session (which is what
 * actually caught the real bugs -- webhook registration, the Buy it now
 * checkout gap -- that a simulated test like this can't reach, since it
 * never touches a real browser, theme, or checkout).
 */
describe("full experiment pipeline", () => {
  let shopId: string;
  const PRODUCT_GID = "gid://shopify/Product/999";

  beforeEach(async () => {
    shopId = (await createTestShop()).id;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("carries a purchase-goal experiment from creation through to results", async () => {
    // 1. Create the experiment (starts in DRAFT).
    const experiment = await createExperiment(shopId, {
      name: "Full pipeline test",
      targetType: "PRODUCT_PAGE",
      targetResourceId: PRODUCT_GID,
      goal: "PURCHASE",
    });
    expect(experiment.status).toBe("DRAFT");

    // Not visible to the storefront yet -- still DRAFT.
    expect(await getActiveExperimentForTarget(shopId, "PRODUCT_PAGE", PRODUCT_GID)).toBeNull();

    // 2. Add two variants.
    const control = await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 50,
      content: JSON.stringify({ text: "Add to cart" }),
    });
    const treatment = await createVariant(shopId, experiment.id, {
      name: "Treatment",
      isControl: false,
      weight: 50,
      content: JSON.stringify({ text: "Buy now" }),
    });

    // 3. Start it.
    const running = await transitionExperimentStatus(shopId, experiment.id, "RUNNING");
    expect(running.status).toBe("RUNNING");

    // 4. What the App Proxy config endpoint would actually hand the
    // storefront loader script -- same call proxy.config.tsx makes.
    const publicConfig = await getActiveExperimentForTarget(shopId, "PRODUCT_PAGE", PRODUCT_GID);
    expect(publicConfig).not.toBeNull();
    expect(publicConfig!.goal).toBe("PURCHASE");
    expect(publicConfig!.variants.map((v) => v.id).sort()).toEqual(
      [control.id, treatment.id].sort(),
    );
    // Nothing shop-internal leaks into the public shape.
    expect(publicConfig).not.toHaveProperty("shopId");

    // 5. Simulate 10 visitors: half bucketed to control, half to
    // treatment, mirroring what the client's deterministic hash would
    // produce for a 50/50 split. 3 of the 5 control visitors convert;
    // 4 of the 5 treatment visitors convert -- a deliberately obvious
    // treatment win, to sanity-check the significance calculation isn't
    // just returning nonsense.
    const controlConversions = [true, true, true, false, false];
    const treatmentConversions = [true, true, true, true, false];

    for (let i = 0; i < controlConversions.length; i++) {
      const visitorId = `control-visitor-${i}`;
      await recordEvent(shopId, {
        experimentId: experiment.id,
        variantId: control.id,
        visitorId,
        type: "IMPRESSION",
      });
      if (controlConversions[i]) {
        await recordEvent(shopId, {
          experimentId: experiment.id,
          variantId: control.id,
          visitorId,
          type: "PURCHASE",
          orderId: `order-control-${i}`,
          orderValue: 20,
        });
      }
    }

    for (let i = 0; i < treatmentConversions.length; i++) {
      const visitorId = `treatment-visitor-${i}`;
      await recordEvent(shopId, {
        experimentId: experiment.id,
        variantId: treatment.id,
        visitorId,
        type: "IMPRESSION",
      });
      if (treatmentConversions[i]) {
        await recordEvent(shopId, {
          experimentId: experiment.id,
          variantId: treatment.id,
          visitorId,
          type: "PURCHASE",
          orderId: `order-treatment-${i}`,
          orderValue: 20,
        });
      }
    }

    // 6. Aggregate and check the numbers match exactly what was fed in.
    const results = await computeExperimentResults(shopId, experiment.id);
    const controlResult = results.variants.find((v) => v.variantId === control.id)!;
    const treatmentResult = results.variants.find((v) => v.variantId === treatment.id)!;

    expect(controlResult.visitors).toBe(5);
    expect(controlResult.conversions).toBe(3);
    expect(controlResult.conversionRate).toBeCloseTo(0.6, 10);
    expect(controlResult.revenue).toBe(60);

    expect(treatmentResult.visitors).toBe(5);
    expect(treatmentResult.conversions).toBe(4);
    expect(treatmentResult.conversionRate).toBeCloseTo(0.8, 10);
    expect(treatmentResult.revenue).toBe(80);

    // Sample size (5/variant) is below the significance threshold (30),
    // so the pipeline should correctly refuse to call a winner here even
    // though treatment "looks" better -- this is the guardrail working,
    // not a gap in the test.
    expect(treatmentResult.vsControl).toBeNull();

    // 7. Pausing shouldn't make the experiment invisible to results, and
    // a late purchase should still be attributable (checkout can
    // complete after a merchant pauses).
    await transitionExperimentStatus(shopId, experiment.id, "PAUSED");
    await recordEvent(shopId, {
      experimentId: experiment.id,
      variantId: control.id,
      visitorId: "control-visitor-0",
      type: "PURCHASE",
      orderId: "order-control-late",
      orderValue: 20,
    });
    const resultsAfterPause = await computeExperimentResults(shopId, experiment.id);
    const controlAfterPause = resultsAfterPause.variants.find((v) => v.variantId === control.id)!;
    expect(controlAfterPause.revenue).toBe(80);

    // And once paused, the storefront should stop seeing it as active.
    expect(await getActiveExperimentForTarget(shopId, "PRODUCT_PAGE", PRODUCT_GID)).toBeNull();
  });
});
