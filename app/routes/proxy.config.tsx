import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  getActiveExperimentForTarget,
  TARGET_TYPES,
  type TargetType,
} from "../models/experiment.server";

// Reached via the App Proxy at /apps/shopsplit/config (see [app_proxy] in
// shopify.app.toml). Public, unauthenticated storefront traffic — the only
// trust boundary is authenticate.public.appProxy's signature check below.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shopDomain = url.searchParams.get("shop");
  const targetTypeParam = url.searchParams.get("targetType") ?? "";
  const targetResourceId = url.searchParams.get("targetResourceId");
  const isValidTargetType = (TARGET_TYPES as readonly string[]).includes(
    targetTypeParam,
  );

  const headers = { "Cache-Control": "public, max-age=30" };

  if (!shopDomain || !isValidTargetType) {
    return Response.json({ experiment: null }, { headers });
  }

  const shop = await getOrCreateShop(shopDomain);
  const experiment = await getActiveExperimentForTarget(
    shop.id,
    targetTypeParam as TargetType,
    targetResourceId,
  );

  return Response.json({ experiment }, { headers });
};
