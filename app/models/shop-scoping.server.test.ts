import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExperiment,
  ExperimentError,
  getExperiment,
  listExperiments,
  transitionExperimentStatus,
  updateExperiment,
} from "./experiment.server";
import {
  createVariant,
  deleteVariant,
  listVariants,
  updateVariant,
} from "./variant.server";
import { computeExperimentResults } from "./results.server";
import { EventError, recordEvent } from "./event.server";
import { cleanupShop, createTestShop } from "./test-helpers.server";

/**
 * Every model function takes a shopId and is meant to scope every query by
 * it, but that's enforced by convention (each function remembers to filter),
 * not by anything structural. This suite is the regression guard: it drives
 * every mutating/reading function with a real experiment/variant id that
 * belongs to shop A, but calls it as shop B, and asserts the operation is
 * rejected exactly as if the id didn't exist. See the security review in
 * GITHUB_ISSUES.md -- this automates what was previously a one-time manual
 * audit.
 */
describe("cross-shop access", () => {
  let shopAId: string;
  let shopBId: string;

  beforeEach(async () => {
    shopAId = (await createTestShop()).id;
    shopBId = (await createTestShop()).id;
  });

  afterEach(async () => {
    await cleanupShop(shopAId);
    await cleanupShop(shopBId);
  });

  it("shop B cannot read shop A's experiment by id", async () => {
    const experiment = await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });

    await expect(getExperiment(shopBId, experiment.id)).rejects.toThrow(
      ExperimentError,
    );
  });

  it("shop B cannot update shop A's experiment by id", async () => {
    const experiment = await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });

    await expect(
      updateExperiment(shopBId, experiment.id, { name: "Hijacked" }),
    ).rejects.toThrow(ExperimentError);

    const stillOwnedByA = await getExperiment(shopAId, experiment.id);
    expect(stillOwnedByA.name).toBe("Shop A only");
  });

  it("shop B cannot transition shop A's experiment by id", async () => {
    const experiment = await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopAId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 50,
      content: "{}",
    });
    await createVariant(shopAId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 50,
      content: "{}",
    });

    await expect(
      transitionExperimentStatus(shopBId, experiment.id, "RUNNING"),
    ).rejects.toThrow(ExperimentError);

    const stillDraft = await getExperiment(shopAId, experiment.id);
    expect(stillDraft.status).toBe("DRAFT");
  });

  it("shop B cannot list, create, update, or delete shop A's variants by experiment id", async () => {
    const experiment = await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const variant = await createVariant(shopAId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });

    await expect(listVariants(shopBId, experiment.id)).rejects.toThrow(
      ExperimentError,
    );
    await expect(
      createVariant(shopBId, experiment.id, {
        name: "Injected",
        isControl: false,
        weight: 0,
        content: "{}",
      }),
    ).rejects.toThrow(ExperimentError);
    await expect(
      updateVariant(shopBId, experiment.id, variant.id, { name: "Hijacked" }),
    ).rejects.toThrow(ExperimentError);
    await expect(
      deleteVariant(shopBId, experiment.id, variant.id),
    ).rejects.toThrow(ExperimentError);

    const stillThere = await listVariants(shopAId, experiment.id);
    expect(stillThere).toHaveLength(1);
    expect(stillThere[0].name).toBe("Control");
  });

  it("shop B cannot read shop A's results by experiment id", async () => {
    const experiment = await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopAId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });
    await createVariant(shopAId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 0,
      content: "{}",
    });
    await transitionExperimentStatus(shopAId, experiment.id, "RUNNING");

    await expect(
      computeExperimentResults(shopBId, experiment.id),
    ).rejects.toThrow(ExperimentError);
  });

  it("shop B cannot record events against shop A's experiment/variant ids", async () => {
    const experiment = await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const control = await createVariant(shopAId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });
    await createVariant(shopAId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 0,
      content: "{}",
    });
    await transitionExperimentStatus(shopAId, experiment.id, "RUNNING");

    await expect(
      recordEvent(shopBId, {
        experimentId: experiment.id,
        variantId: control.id,
        visitorId: "attacker-visitor",
        type: "IMPRESSION",
      }),
    ).rejects.toThrow(EventError);

    // Confirm the attempt left no trace on shop A's real data.
    const results = await computeExperimentResults(shopAId, experiment.id);
    const controlResult = results.variants.find((v) => v.variantId === control.id);
    expect(controlResult?.visitors).toBe(0);
  });

  it("listExperiments for shop B never includes shop A's experiments", async () => {
    await createExperiment(shopAId, {
      name: "Shop A only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createExperiment(shopBId, {
      name: "Shop B only",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });

    const shopBExperiments = await listExperiments(shopBId);
    expect(shopBExperiments).toHaveLength(1);
    expect(shopBExperiments[0].name).toBe("Shop B only");
  });
});
