import type { ActionFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  createExperiment,
  EXPERIMENT_GOALS,
  TARGET_TYPES,
} from "../models/experiment.server";
import { z } from "zod";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
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
                {actionData.error}
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

            <s-text-field
              name="targetResourceId"
              label="Target product ID (optional)"
              details="Leave blank to target a site-wide banner, or paste a product GID for a product-page test."
            />

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
