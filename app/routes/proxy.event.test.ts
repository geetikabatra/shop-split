import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockAppProxy = vi.fn();
vi.mock("../shopify.server", () => ({
  authenticate: { public: { appProxy: (...args: unknown[]) => mockAppProxy(...args) } },
}));

const { action } = await import("./proxy.event");
const { createExperiment, transitionExperimentStatus } = await import("../models/experiment.server");
const { createVariant } = await import("../models/variant.server");
const { createTestShop, cleanupShop } = await import("../models/test-helpers.server");

async function runningExperiment(shopId: string) {
  const experiment = await createExperiment(shopId, {
    name: "Proxy event test",
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
  return { experimentId: experiment.id, variantId: control.id };
}

function eventRequest(
  shopDomain: string,
  body: unknown,
  options: { method?: string; ip?: string } = {},
) {
  const url = `https://example.com/apps/shopsplit/event?shop=${shopDomain}`;
  return new Request(url, {
    method: options.method ?? "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.ip ? { "x-forwarded-for": options.ip } : {}),
    },
    body: options.method === "GET" ? undefined : JSON.stringify(body),
  });
}

describe("proxy.event action", () => {
  let shopId: string;
  let shopDomain: string;

  beforeEach(async () => {
    const shop = await createTestShop();
    shopId = shop.id;
    shopDomain = shop.domain;
    mockAppProxy.mockResolvedValue({});
  });

  afterEach(async () => {
    await cleanupShop(shopId);
  });

  it("records a valid IMPRESSION event", async () => {
    const { experimentId, variantId } = await runningExperiment(shopId);

    const response = await action({
      request: eventRequest(
        shopDomain,
        { experimentId, variantId, visitorId: "visitor-1", type: "IMPRESSION" },
        { ip: "203.0.113.10" },
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(response.status).toBe(204);
  });

  it("rejects a PURCHASE type from the client", async () => {
    const { experimentId, variantId } = await runningExperiment(shopId);

    const response = await action({
      request: eventRequest(
        shopDomain,
        { experimentId, variantId, visitorId: "visitor-2", type: "PURCHASE" },
        { ip: "203.0.113.11" },
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(response.status).toBe(400);
  });

  it("rejects a non-POST request", async () => {
    const response = await action({
      request: eventRequest(shopDomain, {}, { method: "GET", ip: "203.0.113.12" }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(response.status).toBe(405);
  });

  it("rejects a request missing the shop query param", async () => {
    const response = await action({
      request: new Request("https://example.com/apps/shopsplit/event", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.13" },
        body: JSON.stringify({}),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(response.status).toBe(400);
  });

  it("rate limits after too many requests from the same IP", async () => {
    const { experimentId, variantId } = await runningExperiment(shopId);
    const ip = "203.0.113.99";
    let lastResponse: Response | undefined;

    for (let i = 0; i < 32; i++) {
      lastResponse = await action({
        request: eventRequest(
          shopDomain,
          { experimentId, variantId, visitorId: `visitor-rl-${i}`, type: "IMPRESSION" },
          { ip },
        ),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    expect(lastResponse?.status).toBe(429);
  });
});
