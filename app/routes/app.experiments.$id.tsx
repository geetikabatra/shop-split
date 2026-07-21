import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import {
  ExperimentError,
  getExperiment,
  transitionExperimentStatus,
  updateExperiment,
  type ExperimentStatus,
} from "../models/experiment.server";
import { createVariant, deleteVariant } from "../models/variant.server";
import { computeExperimentResults } from "../models/results.server";
import { MIN_SAMPLE_SIZE_PER_VARIANT } from "../utils/stats.server";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  try {
    const experiment = await getExperiment(shop.id, params.id!);
    const results = await computeExperimentResults(shop.id, params.id!);
    return { experiment, results, minSampleSize: MIN_SAMPLE_SIZE_PER_VARIANT };
  } catch (error) {
    if (error instanceof ExperimentError) {
      throw data({ message: error.message }, { status: 404 });
    }
    throw error;
  }
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const experimentId = params.id!;
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  try {
    switch (intent) {
      case "add-variant": {
        await createVariant(shop.id, experimentId, {
          name: String(formData.get("name") ?? ""),
          isControl: formData.get("isControl") === "on",
          weight: Number(formData.get("weight") ?? 0),
          content: JSON.stringify({
            text: String(formData.get("content") ?? ""),
          }),
        });
        return { ok: true };
      }
      case "delete-variant": {
        await deleteVariant(shop.id, experimentId, String(formData.get("variantId")));
        return { ok: true };
      }
      case "transition": {
        await transitionExperimentStatus(
          shop.id,
          experimentId,
          String(formData.get("nextStatus")) as ExperimentStatus,
        );
        return { ok: true };
      }
      case "update-experiment": {
        await updateExperiment(shop.id, experimentId, {
          name: String(formData.get("name") ?? ""),
        });
        return { ok: true };
      }
      default:
        return { error: "Unknown action" };
    }
  } catch (error) {
    if (error instanceof ExperimentError) {
      return { error: error.message };
    }
    return { error: error instanceof Error ? error.message : "Something went wrong" };
  }
};

const NEXT_STATUS: Partial<Record<ExperimentStatus, { label: string; next: ExperimentStatus; tone: "auto" | "critical" }[]>> = {
  DRAFT: [{ label: "Start experiment", next: "RUNNING", tone: "auto" }],
  RUNNING: [
    { label: "Pause", next: "PAUSED", tone: "critical" },
    { label: "Complete", next: "COMPLETED", tone: "critical" },
  ],
  PAUSED: [
    { label: "Resume", next: "RUNNING", tone: "auto" },
    { label: "Complete", next: "COMPLETED", tone: "critical" },
  ],
};

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}

function formatMoney(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export default function ExperimentDetail() {
  const { experiment, results, minSampleSize } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const isDraft = experiment.status === "DRAFT";
  const weightSum = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
  const actions = NEXT_STATUS[experiment.status as ExperimentStatus] ?? [];

  const control = results.variants.find((v) => v.isControl);
  const winner = results.variants.find(
    (v) =>
      !v.isControl &&
      v.vsControl?.significantAt95 &&
      control &&
      v.conversionRate > control.conversionRate,
  );

  return (
    <s-page heading={experiment.name}>
      <s-link slot="breadcrumb-actions" href="/app/experiments">
        Experiments
      </s-link>

      {actionData?.error && (
        <s-banner tone="critical" heading="Action failed">
          {actionData.error}
        </s-banner>
      )}

      <s-section heading="Overview">
        <s-stack direction="inline" gap="large">
          <s-stack direction="inline" gap="small" alignItems="center">
            <s-text type="strong">Status: </s-text>
            <s-badge
              tone={
                experiment.status === "RUNNING"
                  ? "success"
                  : experiment.status === "PAUSED"
                    ? "warning"
                    : experiment.status === "COMPLETED"
                      ? "info"
                      : "neutral"
              }
            >
              {experiment.status}
            </s-badge>
          </s-stack>
          <s-paragraph>
            <s-text type="strong">Target: </s-text>
            {experiment.targetType}
          </s-paragraph>
          <s-paragraph>
            <s-text type="strong">Goal: </s-text>
            {experiment.goal}
          </s-paragraph>
        </s-stack>

        {actions.length > 0 && (
          <s-stack direction="inline" gap="base">
            {actions.map((a) => (
              <Form method="post" key={a.next}>
                <input type="hidden" name="intent" value="transition" />
                <input type="hidden" name="nextStatus" value={a.next} />
                <s-button
                  type="submit"
                  tone={a.tone}
                  {...(isSubmitting ? { loading: true } : {})}
                >
                  {a.label}
                </s-button>
              </Form>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section
        heading="Variants"
        accessibilityLabel={`Weights total ${weightSum} of 100`}
      >
        {experiment.variants.length === 0 ? (
          <s-paragraph>No variants yet. Add at least two, including a control, before starting.</s-paragraph>
        ) : (
          <s-table>
            <s-table-header-row>
              <s-table-header>Name</s-table-header>
              <s-table-header>Control</s-table-header>
              <s-table-header>Weight</s-table-header>
              <s-table-header>Content</s-table-header>
              {isDraft && <s-table-header>Actions</s-table-header>}
            </s-table-header-row>
            <s-table-body>
              {experiment.variants.map((variant) => (
                <s-table-row key={variant.id}>
                  <s-table-cell>{variant.name}</s-table-cell>
                  <s-table-cell>{variant.isControl ? "Yes" : ""}</s-table-cell>
                  <s-table-cell>{variant.weight}%</s-table-cell>
                  <s-table-cell>{variant.content}</s-table-cell>
                  {isDraft && (
                    <s-table-cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete-variant" />
                        <input type="hidden" name="variantId" value={variant.id} />
                        <s-button type="submit" variant="tertiary" tone="critical">
                          Remove
                        </s-button>
                      </Form>
                    </s-table-cell>
                  )}
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
        <s-paragraph>Weights total: {weightSum} / 100</s-paragraph>

        {isDraft && (
          <s-box paddingBlockStart="base">
            <Form method="post">
              <input type="hidden" name="intent" value="add-variant" />
              <s-stack direction="block" gap="base">
                <s-text-field name="name" label="Variant name" required />
                <s-checkbox name="isControl" label="This is the control variant" />
                <s-number-field name="weight" label="Traffic weight (%)" min={0} max={100} required />
                <s-text-field
                  name="content"
                  label="Content override"
                  details="e.g. the CTA text, banner copy, or price copy for this variant"
                />
                <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
                  Add variant
                </s-button>
              </s-stack>
            </Form>
          </s-box>
        )}
      </s-section>

      <s-section heading="Results">
        {isDraft ? (
          <s-paragraph>Results will appear here once the experiment starts.</s-paragraph>
        ) : (
          <>
            <s-link href={`/app/experiments/${experiment.id}/export`}>Export CSV</s-link>
            <s-table>
              <s-table-header-row>
                <s-table-header>Variant</s-table-header>
                <s-table-header>Visitors</s-table-header>
                <s-table-header>Conversions</s-table-header>
                <s-table-header>Conversion rate</s-table-header>
                <s-table-header>Revenue / visitor</s-table-header>
                <s-table-header>vs control</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {results.variants.map((variant) => (
                  <s-table-row key={variant.variantId}>
                    <s-table-cell>
                      {variant.name}
                      {variant.isControl && " (control)"}
                      {winner?.variantId === variant.variantId && (
                        <s-badge tone="success">Winner</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>{variant.visitors}</s-table-cell>
                    <s-table-cell>{variant.conversions}</s-table-cell>
                    <s-table-cell>{formatPercent(variant.conversionRate)}</s-table-cell>
                    <s-table-cell>{formatMoney(variant.revenuePerVisitor)}</s-table-cell>
                    <s-table-cell>
                      {variant.isControl
                        ? "—"
                        : variant.vsControl
                          ? `${formatPercent(variant.vsControl.confidenceLevel)} confidence`
                          : `Not enough data yet (min ${minSampleSize}/variant)`}
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </>
        )}
      </s-section>
    </s-page>
  );
}
