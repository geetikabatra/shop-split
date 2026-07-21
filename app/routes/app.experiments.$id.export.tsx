import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { getOrCreateShop } from "../models/shop.server";
import { getExperiment } from "../models/experiment.server";
import { computeExperimentResults } from "../models/results.server";

function csvField(value: string | number): string {
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const HEADER = [
  "Variant",
  "Control",
  "Visitors",
  "Conversions",
  "Conversion Rate",
  "Revenue",
  "Revenue Per Visitor",
  "Confidence vs Control",
];

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = await getOrCreateShop(session.shop);

  const experiment = await getExperiment(shop.id, params.id!);
  const results = await computeExperimentResults(shop.id, params.id!);

  const rows = results.variants.map((variant) =>
    [
      variant.name,
      variant.isControl ? "yes" : "no",
      variant.visitors,
      variant.conversions,
      (variant.conversionRate * 100).toFixed(2) + "%",
      variant.revenue.toFixed(2),
      variant.revenuePerVisitor.toFixed(2),
      variant.vsControl ? (variant.vsControl.confidenceLevel * 100).toFixed(2) + "%" : "",
    ]
      .map(csvField)
      .join(","),
  );

  const csv = [HEADER.join(","), ...rows].join("\n") + "\n";
  const filename = `${experiment.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-results.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
