import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { recordEvent } from "../models/event.server";
import { captureException } from "../utils/sentry.server";

const NOTE_ATTRIBUTE_PREFIX = "shopsplit_";
// Leading underscore matches shopsplit-loader.js's
// tagLineItemPropertiesForPurchaseAttribution() -- Shopify hides
// underscore-prefixed line item properties from the customer-facing
// cart/checkout UI, but they still land here in line_items[].properties.
const LINE_ITEM_PROPERTY_PREFIX = "_shopsplit_";

interface OrderAttribute {
  name?: unknown;
  value?: unknown;
}

interface OrderLineItem {
  properties?: OrderAttribute[];
}

async function attributeFromTag(
  shop: { id: string },
  shopDomain: string,
  orderId: string,
  orderValue: number,
  prefix: string,
  name: unknown,
  value: unknown,
) {
  if (typeof name !== "string" || !name.startsWith(prefix) || typeof value !== "string") {
    return;
  }

  const experimentId = name.slice(prefix.length);
  const [variantId, visitorId] = value.split(":");
  if (!variantId || !visitorId) return;

  try {
    await recordEvent(shop.id, {
      experimentId,
      variantId,
      visitorId,
      type: "PURCHASE",
      orderId,
      orderValue,
    });
    console.log(
      `Recorded PURCHASE for experiment ${experimentId}, variant ${variantId}, order ${orderId} ($${orderValue})`,
    );
  } catch (error) {
    // A stale/tampered attribute referencing an unknown experiment or
    // variant shouldn't fail the whole webhook -- report and keep going.
    captureException(error, { shopDomain, orderId, experimentId, variantId });
  }
}

// Two independent attribution channels feed into the same recordEvent call
// below: cart note_attributes (the normal Add to cart -> Checkout path) and
// line item properties (aimed at dynamic checkout buttons like "Buy it
// now" -- see shopsplit-loader.js). A normal purchase tags both channels
// with the same experiment/variant, but recordEvent's (orderId, type)
// uniqueness means only the first one recorded for an order sticks -- the
// second is silently treated as a no-op duplicate, not a double count.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop: shopDomain, topic, payload } = await authenticate.webhook(request);

  const shop = await getOrCreateShop(shopDomain);
  const orderId = String(payload.id ?? "");
  const orderValue = Number(payload.total_price ?? payload.current_total_price ?? 0);
  const noteAttributes: OrderAttribute[] = Array.isArray(payload.note_attributes)
    ? payload.note_attributes
    : [];
  const lineItems: OrderLineItem[] = Array.isArray(payload.line_items) ? payload.line_items : [];
  const lineItemProperties: OrderAttribute[] = lineItems.flatMap((item) =>
    Array.isArray(item?.properties) ? item.properties : [],
  );

  console.log(
    `Received ${topic} webhook for ${shopDomain}, order ${orderId}, ` +
      `${noteAttributes.length} note attribute(s), ${lineItemProperties.length} line item propert(y/ies):`,
    { noteAttributes, lineItemProperties },
  );

  for (const attribute of noteAttributes) {
    await attributeFromTag(
      shop,
      shopDomain,
      orderId,
      orderValue,
      NOTE_ATTRIBUTE_PREFIX,
      attribute?.name,
      attribute?.value,
    );
  }
  for (const property of lineItemProperties) {
    await attributeFromTag(
      shop,
      shopDomain,
      orderId,
      orderValue,
      LINE_ITEM_PROPERTY_PREFIX,
      property?.name,
      property?.value,
    );
  }

  return new Response();
};
