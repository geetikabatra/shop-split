import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { recordEvent } from "../models/event.server";

const ATTRIBUTE_PREFIX = "shopsplit_";

interface OrderNoteAttribute {
  name?: unknown;
  value?: unknown;
}

// Cart attributes carry through to the order's note_attributes unchanged,
// so the "shopsplit_<experimentId>": "<variantId>:<visitorId>" tags set by
// shopsplit-loader.js's tagCartForPurchaseAttribution() land here.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, payload } = await authenticate.webhook(request);

  const shop = await getOrCreateShop(shopDomain);
  const orderId = String(payload.id ?? "");
  const orderValue = Number(payload.total_price ?? payload.current_total_price ?? 0);
  const noteAttributes: OrderNoteAttribute[] = Array.isArray(payload.note_attributes)
    ? payload.note_attributes
    : [];

  for (const attribute of noteAttributes) {
    const name = attribute?.name;
    const value = attribute?.value;
    if (typeof name !== "string" || !name.startsWith(ATTRIBUTE_PREFIX) || typeof value !== "string") {
      continue;
    }

    const experimentId = name.slice(ATTRIBUTE_PREFIX.length);
    const [variantId, visitorId] = value.split(":");
    if (!variantId || !visitorId) continue;

    try {
      await recordEvent(shop.id, {
        experimentId,
        variantId,
        visitorId,
        type: "PURCHASE",
        orderId,
        orderValue,
      });
    } catch (error) {
      // A stale/tampered attribute referencing an unknown experiment or
      // variant shouldn't fail the whole webhook -- log and keep going.
      console.error(`Failed to record purchase event for order ${orderId}:`, error);
    }
  }

  return new Response();
};
