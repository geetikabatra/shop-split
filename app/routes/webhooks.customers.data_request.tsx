import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// Mandatory GDPR webhook. ShopSplit never links a visitor to a Shopify
// customer identity -- the visitorId cookie is an app-generated random
// string (see shopsplit-loader.js), not a customer ID, email, or any
// other Shopify-provided identifier. There is no customer-linked data in
// our database for this request to act on.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop} -- no customer-linked data held, nothing to export`);
  return new Response();
};
