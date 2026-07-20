import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { listExperiments } from "../models/experiment.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);
  const experiments = await listExperiments(shop.id);
  return { experiments };
};

const STATUS_TONE: Record<string, "neutral" | "success" | "warning" | "info"> = {
  DRAFT: "neutral",
  RUNNING: "success",
  PAUSED: "warning",
  COMPLETED: "info",
};

export default function ExperimentsIndex() {
  const { experiments } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Experiments">
      <s-button slot="primary-action" href="/app/experiments/new" variant="primary">
        Create experiment
      </s-button>

      {experiments.length === 0 ? (
        <s-section heading="No experiments yet">
          <s-paragraph>
            Create your first experiment to start A/B testing your storefront —
            try a different CTA, price display, or banner and see what
            converts better.
          </s-paragraph>
          <s-button href="/app/experiments/new" variant="primary">
            Create experiment
          </s-button>
        </s-section>
      ) : (
        <s-section
          heading={`${experiments.length} experiment${experiments.length === 1 ? "" : "s"}`}
        >
          <s-table>
            <s-table-header-row>
              <s-table-header>Name</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Target</s-table-header>
              <s-table-header>Goal</s-table-header>
              <s-table-header>Variants</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {experiments.map((experiment) => (
                <s-table-row key={experiment.id}>
                  <s-table-cell>
                    <s-link href={`/app/experiments/${experiment.id}`}>
                      {experiment.name}
                    </s-link>
                  </s-table-cell>
                  <s-table-cell>
                    <s-badge tone={STATUS_TONE[experiment.status] ?? "neutral"}>
                      {experiment.status}
                    </s-badge>
                  </s-table-cell>
                  <s-table-cell>{experiment.targetType}</s-table-cell>
                  <s-table-cell>{experiment.goal}</s-table-cell>
                  <s-table-cell>{experiment.variants.length}</s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}
    </s-page>
  );
}
