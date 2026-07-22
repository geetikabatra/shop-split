import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks only the Shopify SDK auth boundary -- everything below it (the
// model layer, the route's own limit-enforcement logic) runs for real
// against the test database, so this exercises the actual integration,
// not just the model layer in isolation.
const mockAdmin = vi.fn();
vi.mock("../shopify.server", () => ({
  authenticate: { admin: (...args: unknown[]) => mockAdmin(...args) },
  // Must match billing-plans.ts's GROWTH_PLAN.
  GROWTH_PLAN: "Growth",
}));

const { action } = await import("./app.experiments.new");
const { createExperiment, transitionExperimentStatus } = await import("../models/experiment.server");
const { createVariant } = await import("../models/variant.server");
const { createTestShop, cleanupShop } = await import("../models/test-helpers.server");

function freePlanSession(shopDomain: string) {
  return {
    session: { shop: shopDomain },
    billing: { check: vi.fn().mockResolvedValue({ hasActivePayment: false, appSubscriptions: [] }) },
  };
}

function growthPlanSession(shopDomain: string) {
  return {
    session: { shop: shopDomain },
    billing: {
      check: vi
        .fn()
        .mockResolvedValue({ hasActivePayment: true, appSubscriptions: [{ name: "Growth" }] }),
    },
  };
}

function postRequest(fields: Record<string, string>) {
  const formData = new URLSearchParams(fields);
  return new Request("https://example.com/app/experiments/new", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
}

describe("app.experiments.new action", () => {
  let shopDomain: string;
  let shopId: string;

  beforeEach(async () => {
    const shop = await createTestShop();
    shopId = shop.id;
    shopDomain = shop.domain;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("creates an experiment and redirects to its detail page", async () => {
    mockAdmin.mockResolvedValue(freePlanSession(shopDomain));

    const response = (await action({
      request: postRequest({ name: "First test", targetType: "PRODUCT_PAGE", goal: "ADD_TO_CART" }),
      params: {},
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Response;

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toMatch(/^\/app\/experiments\/.+/);
  });

  it("rejects invalid input with an error, not a crash", async () => {
    mockAdmin.mockResolvedValue(freePlanSession(shopDomain));

    const result = await action({
      request: postRequest({ name: "", targetType: "PRODUCT_PAGE", goal: "ADD_TO_CART" }),
      params: {},
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("blocks a second active experiment on the free plan", async () => {
    mockAdmin.mockResolvedValue(freePlanSession(shopDomain));

    const existing = await createExperiment(shopId, {
      name: "Already active",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    expect(existing.status).toBe("DRAFT");

    const result = await action({
      request: postRequest({ name: "Second one", targetType: "PRODUCT_PAGE", goal: "ADD_TO_CART" }),
      params: {},
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(result).toMatchObject({ upgrade: true });
  });

  it("allows multiple active experiments on the Growth plan", async () => {
    mockAdmin.mockResolvedValue(growthPlanSession(shopDomain));

    await createExperiment(shopId, {
      name: "Already active",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });

    const response = (await action({
      request: postRequest({ name: "Second one", targetType: "PRODUCT_PAGE", goal: "ADD_TO_CART" }),
      params: {},
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Response;

    expect(response.status).toBe(302);
  });

  it("does not count a COMPLETED experiment against the free-plan limit", async () => {
    mockAdmin.mockResolvedValue(freePlanSession(shopDomain));

    const completed = await createExperiment(shopId, {
      name: "Done already",
      targetType: "PRODUCT_PAGE",
      goal: "ADD_TO_CART",
    });
    await createVariant(shopId, completed.id, {
      name: "Control",
      isControl: true,
      weight: 100,
      content: "{}",
    });
    await createVariant(shopId, completed.id, {
      name: "B",
      isControl: false,
      weight: 0,
      content: "{}",
    });
    await transitionExperimentStatus(shopId, completed.id, "RUNNING");
    await transitionExperimentStatus(shopId, completed.id, "COMPLETED");

    const response = (await action({
      request: postRequest({ name: "New one", targetType: "PRODUCT_PAGE", goal: "ADD_TO_CART" }),
      params: {},
      context: {},
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)) as Response;

    expect(response.status).toBe(302);
  });
});
