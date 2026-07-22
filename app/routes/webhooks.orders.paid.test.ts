import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockWebhook = vi.fn();
vi.mock("../shopify.server", () => ({
  authenticate: { webhook: (...args: unknown[]) => mockWebhook(...args) },
}));

const { action } = await import("./webhooks.orders.paid");
const { createExperiment, transitionExperimentStatus } = await import("../models/experiment.server");
const { createVariant } = await import("../models/variant.server");
const { createTestShop, cleanupShop } = await import("../models/test-helpers.server");
const prisma = (await import("../db.server")).default;

async function runningExperiment(shopId: string) {
  const experiment = await createExperiment(shopId, {
    name: "Purchase webhook test",
    targetType: "PRODUCT_PAGE",
    goal: "PURCHASE",
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
  return { experimentId: experiment.id, variantId: control.id };
}

function webhookRequest() {
  return new Request("https://example.com/webhooks/orders/paid", { method: "POST" });
}

describe("webhooks.orders.paid action", () => {
  let shopId: string;
  let shopDomain: string;

  beforeEach(async () => {
    const shop = await createTestShop();
    shopId = shop.id;
    shopDomain = shop.domain;
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("records a PURCHASE event from a correctly tagged note attribute", async () => {
    const { experimentId, variantId } = await runningExperiment(shopId);
    mockWebhook.mockResolvedValue({
      shop: shopDomain,
      topic: "ORDERS_PAID",
      payload: {
        id: 9001,
        total_price: "42.50",
        note_attributes: [{ name: `shopsplit_${experimentId}`, value: `${variantId}:visitor-1` }],
      },
    });

    await action({ request: webhookRequest() } as never);

    const events = await prisma.event.findMany({ where: { experimentId, type: "PURCHASE" } });
    expect(events).toHaveLength(1);
    expect(events[0].orderId).toBe("9001");
    expect(events[0].orderValue).toBe(42.5);
  });

  it("ignores unrelated note attributes without error", async () => {
    mockWebhook.mockResolvedValue({
      shop: shopDomain,
      topic: "ORDERS_PAID",
      payload: {
        id: 9002,
        total_price: "10.00",
        note_attributes: [{ name: "gift_message", value: "Happy birthday!" }],
      },
    });

    const response = await action({ request: webhookRequest() } as never);
    expect(response.status).toBe(200);
  });

  it("skips a malformed attribute value gracefully", async () => {
    const { experimentId } = await runningExperiment(shopId);
    mockWebhook.mockResolvedValue({
      shop: shopDomain,
      topic: "ORDERS_PAID",
      payload: {
        id: 9003,
        total_price: "10.00",
        note_attributes: [{ name: `shopsplit_${experimentId}`, value: "not-a-valid-pair" }],
      },
    });

    const response = await action({ request: webhookRequest() } as never);
    expect(response.status).toBe(200);
    const events = await prisma.event.findMany({ where: { experimentId, type: "PURCHASE" } });
    expect(events).toHaveLength(0);
  });

  it("is idempotent when the same webhook is delivered twice", async () => {
    const { experimentId, variantId } = await runningExperiment(shopId);
    mockWebhook.mockResolvedValue({
      shop: shopDomain,
      topic: "ORDERS_PAID",
      payload: {
        id: 9004,
        total_price: "15.00",
        note_attributes: [{ name: `shopsplit_${experimentId}`, value: `${variantId}:visitor-2` }],
      },
    });

    await action({ request: webhookRequest() } as never);
    await action({ request: webhookRequest() } as never);

    const events = await prisma.event.findMany({ where: { experimentId, type: "PURCHASE" } });
    expect(events).toHaveLength(1);
  });
});
