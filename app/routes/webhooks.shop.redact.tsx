import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// Mandatory GDPR webhook, sent ~48 hours after a shop uninstalls the app.
// Unlike customers/data_request and customers/redact, this one has real
// work to do: permanently purge everything we hold for this shop.
// Deleting the Shop row cascades to Experiment -> Variant/Assignment/Event
// via the schema's onDelete: Cascade relations, so a single delete is a
// complete purge.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop} -- purging all shop data`);

  await db.shop.deleteMany({ where: { domain: shop } });
  // Defense in depth: app/uninstalled should have already cleared these
  // ~48 hours earlier, but don't rely on that having succeeded.
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
