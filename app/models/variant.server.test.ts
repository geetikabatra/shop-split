import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExperiment,
  ExperimentError,
  transitionExperimentStatus,
} from "./experiment.server";
import { createVariant, deleteVariant, updateVariant } from "./variant.server";
import { cleanupShop, createTestShop } from "./test-helpers.server";

// re-exported from experiment.server via variant.server's import; ensure it's the same class
describe("variant weight validation", () => {
  let shopId: string;

  beforeEach(async () => {
    shopId = (await createTestShop()).id;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("allows building up variants that don't yet total 100", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Incremental build",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const variant = await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 40,
      content: "{}",
    });
    expect(variant.weight).toBe(40);
  });

  it("rejects a new variant that pushes the total over 100", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Overflow",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 70,
      content: "{}",
    });

    await expect(
      createVariant(shopId, experiment.id, {
        name: "B",
        isControl: false,
        weight: 40,
        content: "{}",
      }),
    ).rejects.toThrow(/cannot exceed 100/);
  });

  it("rejects updating a variant's weight if it would push the total over 100", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Update overflow",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const control = await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 50,
      content: "{}",
    });
    await createVariant(shopId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 50,
      content: "{}",
    });

    await expect(
      updateVariant(shopId, experiment.id, control.id, { weight: 60 }),
    ).rejects.toThrow(/cannot exceed 100/);
  });

  it("blocks variant edits once the experiment is running", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Locked once running",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    const control = await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 50,
      content: "{}",
    });
    await createVariant(shopId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 50,
      content: "{}",
    });
    await transitionExperimentStatus(shopId, experiment.id, "RUNNING");

    await expect(
      updateVariant(shopId, experiment.id, control.id, { weight: 10 }),
    ).rejects.toThrow(ExperimentError);
    await expect(
      deleteVariant(shopId, experiment.id, control.id),
    ).rejects.toThrow(ExperimentError);
  });
});
