import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, Form } from "react-router";
import { authenticate } from "../shopify.server";
import {
  FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT,
  getMaxActiveExperiments,
  GROWTH_PLAN,
} from "../models/billing-plans";
import { getOrCreateShop } from "../models/shop.server";
import { countActiveExperiments } from "../models/experiment.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { hasActivePayment, appSubscriptions } = await billing.check({ plans: [GROWTH_PLAN] });
  const subscription = hasActivePayment ? appSubscriptions[0] : null;
  const activeExperiments = await countActiveExperiments(shop.id);
  const maxActiveExperiments = getMaxActiveExperiments(subscription?.name ?? null);

  return {
    subscription: subscription ? { id: subscription.id, name: subscription.name } : null,
    activeExperiments,
    maxActiveExperiments,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "upgrade") {
    // isTest: true while this app is still pre-launch -- Shopify blocks
    // real charges on dev stores regardless, but this should be revisited
    // (see the deployment-hardening issue in GITHUB_ISSUES.md) before a
    // real production launch, where merchants must actually be charged.
    return billing.request({ plan: GROWTH_PLAN, isTest: true });
  }

  if (intent === "cancel") {
    const subscriptionId = String(formData.get("subscriptionId") ?? "");
    await billing.cancel({ subscriptionId, isTest: true, prorate: true });
    return { ok: true };
  }

  return { error: "Unknown action" };
};

export default function Billing() {
  const { subscription, activeExperiments, maxActiveExperiments } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Billing">
      {actionData && "error" in actionData && actionData.error && (
        <s-banner tone="critical" heading="Action failed">
          {actionData.error}
        </s-banner>
      )}

      <s-section heading="Current plan">
        <s-paragraph>
          <s-text type="strong">Plan: </s-text>
          {subscription ? subscription.name : "Free"}
        </s-paragraph>
        <s-paragraph>
          <s-text type="strong">Active experiments: </s-text>
          {activeExperiments}
          {maxActiveExperiments !== null ? ` / ${maxActiveExperiments}` : " (unlimited)"}
        </s-paragraph>

        {subscription ? (
          <Form method="post">
            <input type="hidden" name="intent" value="cancel" />
            <input type="hidden" name="subscriptionId" value={subscription.id} />
            <s-button type="submit" tone="critical" {...(isSubmitting ? { loading: true } : {})}>
              Cancel subscription
            </s-button>
          </Form>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="upgrade" />
            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Upgrade to Growth -- $9.99/month
            </s-button>
          </Form>
        )}
      </s-section>

      <s-section heading="Plans">
        <s-table>
          <s-table-header-row>
            <s-table-header>Plan</s-table-header>
            <s-table-header>Price</s-table-header>
            <s-table-header>Active experiments</s-table-header>
          </s-table-header-row>
          <s-table-body>
            <s-table-row>
              <s-table-cell>Free</s-table-cell>
              <s-table-cell>$0/month</s-table-cell>
              <s-table-cell>Up to {FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT}</s-table-cell>
            </s-table-row>
            <s-table-row>
              <s-table-cell>{GROWTH_PLAN}</s-table-cell>
              <s-table-cell>$9.99/month</s-table-cell>
              <s-table-cell>Unlimited</s-table-cell>
            </s-table-row>
          </s-table-body>
        </s-table>
        <s-paragraph>
          &ldquo;Active&rdquo; means any experiment that isn&apos;t yet Completed -- Draft,
          Running, and Paused all count. Completed experiments don&apos;t count against your
          limit.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}
