import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createExperiment,
  ExperimentError,
  transitionExperimentStatus,
} from "./experiment.server";
import { createVariant } from "./variant.server";
import { cleanupShop, createTestShop } from "./test-helpers.server";

describe("experiment state machine", () => {
  let shopId: string;

  beforeEach(async () => {
    shopId = (await createTestShop()).id;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("creates an experiment in DRAFT status", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Homepage CTA test",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    expect(experiment.status).toBe("DRAFT");
  });

  it("rejects starting an experiment with fewer than two variants", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Only one variant",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });

    await expect(
      transitionExperimentStatus(shopId, experiment.id, "RUNNING"),
    ).rejects.toThrow(ExperimentError);
  });

  it("rejects starting an experiment with no control variant", async () => {
    const experiment = await createExperiment(shopId, {
      name: "No control",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, experiment.id, {
      name: "A",
      isControl: false,
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
      transitionExperimentStatus(shopId, experiment.id, "RUNNING"),
    ).rejects.toThrow(/control variant/);
  });

  it("rejects starting an experiment whose weights don't sum to 100", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Bad weights",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, experiment.id, {
      name: "Control",
      isControl: true,
      weight: 50,
      content: "{}",
    });
    await createVariant(shopId, experiment.id, {
      name: "B",
      isControl: false,
      weight: 30,
      content: "{}",
    });

    await expect(
      transitionExperimentStatus(shopId, experiment.id, "RUNNING"),
    ).rejects.toThrow(/sum to 100/);
  });

  it("starts a well-formed experiment and stamps startedAt", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Well formed",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, experiment.id, {
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

    const started = await transitionExperimentStatus(
      shopId,
      experiment.id,
      "RUNNING",
    );
    expect(started.status).toBe("RUNNING");
    expect(started.startedAt).not.toBeNull();
  });

  it("rejects illegal transitions like DRAFT -> PAUSED", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Illegal jump",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });

    await expect(
      transitionExperimentStatus(shopId, experiment.id, "PAUSED"),
    ).rejects.toThrow(/Cannot move experiment/);
  });

  it("rejects transitions out of COMPLETED", async () => {
    const experiment = await createExperiment(shopId, {
      name: "Terminal state",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, experiment.id, {
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
    await transitionExperimentStatus(shopId, experiment.id, "COMPLETED");

    await expect(
      transitionExperimentStatus(shopId, experiment.id, "RUNNING"),
    ).rejects.toThrow(/Cannot move experiment/);
  });
});
