import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { EventError, recordEvent } from "../models/event.server";
import { isRateLimited } from "../utils/rate-limit.server";

// Only IMPRESSION and ADD_TO_CART are accepted from the storefront client.
// PURCHASE events only ever come from the orders/paid webhook (see
// app/routes/webhooks.orders.paid.tsx) -- letting a browser self-report a
// purchase with an arbitrary orderValue would let anyone skew results.
const clientEventSchema = z.object({
  experimentId: z.string().min(1),
  variantId: z.string().min(1),
  visitorId: z.string().min(1).max(200),
  type: z.enum(["IMPRESSION", "ADD_TO_CART"]),
});

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  await authenticate.public.appProxy(request);

  const shopDomain = new URL(request.url).searchParams.get("shop");
  if (!shopDomain) {
    return Response.json({ error: "Missing shop" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = clientEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid event payload" }, { status: 400 });
  }

  if (isRateLimited(`${shopDomain}:${parsed.data.visitorId}`)) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const shop = await getOrCreateShop(shopDomain);

  try {
    await recordEvent(shop.id, parsed.data);
  } catch (error) {
    if (error instanceof EventError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  return new Response(null, { status: 204 });
};
