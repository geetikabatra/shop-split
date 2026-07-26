import { useState } from "react";
import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate, GROWTH_PLAN } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  countActiveExperiments,
  createExperiment,
  EXPERIMENT_GOALS,
  TARGET_TYPES,
} from "../models/experiment.server";
import { getMaxActiveExperiments } from "../models/billing-plans";
import { z } from "zod";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const { hasActivePayment, appSubscriptions } = await billing.check({ plans: [GROWTH_PLAN] });
  const planName = hasActivePayment ? (appSubscriptions[0]?.name ?? null) : null;
  const maxActiveExperiments = getMaxActiveExperiments(planName);

  if (maxActiveExperiments !== null) {
    const activeCount = await countActiveExperiments(shop.id);
    if (activeCount >= maxActiveExperiments) {
      return {
        error: `You've reached the ${maxActiveExperiments}-active-experiment limit on the free plan. Complete an existing experiment or upgrade to run more at once.`,
        upgrade: true,
      };
    }
  }

  const formData = await request.formData();

  try {
    const experiment = await createExperiment(shop.id, {
      name: String(formData.get("name") ?? ""),
      targetType: String(formData.get("targetType") ?? "") as (typeof TARGET_TYPES)[number],
      targetResourceId: String(formData.get("targetResourceId") ?? "") || undefined,
      goal: String(formData.get("goal") ?? "") as (typeof EXPERIMENT_GOALS)[number],
    });
    return redirect(`/app/experiments/${experiment.id}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { error: error.issues[0]?.message ?? "Invalid input" };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong" };
  }
};

export default function NewExperiment() {
  const navigation = useNavigation();
  const actionData = useActionData<typeof action>();
  const isSubmitting = navigation.state === "submitting";
  const shopify = useAppBridge();
  const [selectedProduct, setSelectedProduct] = useState<{ id: string; title: string } | null>(
    null,
  );

  const pickProduct = async () => {
    const selection = await shopify.resourcePicker({ type: "product", action: "select" });
    const product = selection?.[0];
    if (product) {
      setSelectedProduct({ id: product.id, title: product.title });
    }
  };

  return (
    <s-page heading="Create experiment">
      <s-link slot="breadcrumb-actions" href="/app/experiments">
        Experiments
      </s-link>
      <s-section>
        <Form method="post">
          <s-stack direction="block" gap="base">
            {actionData?.error && (
              <s-banner tone="critical" heading="Couldn't create experiment">
                <s-paragraph>{actionData.error}</s-paragraph>
                {actionData.upgrade && (
                  <s-button href="/app/billing" slot="secondary-actions">
                    View plans
                  </s-button>
                )}
              </s-banner>
            )}

            <s-text-field
              name="name"
              label="Experiment name"
              placeholder="e.g. Product page CTA color"
              required
            />

            <s-select name="targetType" label="What are you testing?" required>
              <s-option value="PRODUCT_PAGE">Product page</s-option>
              <s-option value="BANNER">Banner</s-option>
            </s-select>

            <input type="hidden" name="targetResourceId" value={selectedProduct?.id ?? ""} />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button type="button" onClick={pickProduct}>
                {selectedProduct ? "Change product" : "Choose product"}
              </s-button>
              {selectedProduct ? (
                <>
                  <s-text>{selectedProduct.title}</s-text>
                  <s-button
                    type="button"
                    variant="tertiary"
                    onClick={() => setSelectedProduct(null)}
                  >
                    Remove
                  </s-button>
                </>
              ) : (
                <s-text color="subdued">
                  No product selected — leave unselected for a site-wide banner.
                </s-text>
              )}
            </s-stack>

            <s-select name="goal" label="Goal metric" required>
              <s-option value="ADD_TO_CART">Add to cart</s-option>
              <s-option value="PURCHASE">Purchase</s-option>
            </s-select>

            <s-button type="submit" variant="primary" {...(isSubmitting ? { loading: true } : {})}>
              Create experiment
            </s-button>
          </s-stack>
        </Form>
      </s-section>
    </s-page>
  );
}
