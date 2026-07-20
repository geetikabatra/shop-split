import { z } from "zod";
import prisma from "../db.server";
import { ExperimentError, getExperiment } from "./experiment.server";

export const createVariantSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  isControl: z.boolean().default(false),
  weight: z.number().int().min(0).max(100),
  content: z.string().min(1, "Content payload is required"),
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = createVariantSchema.partial();
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

async function getEditableExperiment(shopId: string, experimentId: string) {
  const experiment = await getExperiment(shopId, experimentId);
  if (experiment.status !== "DRAFT") {
    throw new ExperimentError(
      "Variants can only be changed while the experiment is in DRAFT status.",
    );
  }
  return experiment;
}

/**
 * Only caps the running total at <= 100 while variants are still being
 * added one at a time. The strict "must equal exactly 100" rule is
 * enforced once, at DRAFT -> RUNNING (see transitionExperimentStatus),
 * since that's the point a partially-built variant set actually matters.
 */
function assertWeightsWithinBudget(weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum > 100) {
    throw new ExperimentError(
      `Variant weights cannot exceed 100 in total (currently ${sum}).`,
    );
  }
}

export async function listVariants(shopId: string, experimentId: string) {
  await getExperiment(shopId, experimentId);
  return prisma.variant.findMany({
    where: { experimentId },
    orderBy: { createdAt: "asc" },
  });
}

export async function createVariant(
  shopId: string,
  experimentId: string,
  input: CreateVariantInput,
) {
  const data = createVariantSchema.parse(input);
  const experiment = await getEditableExperiment(shopId, experimentId);

  assertWeightsWithinBudget([
    ...experiment.variants.map((v) => v.weight),
    data.weight,
  ]);

  return prisma.variant.create({ data: { ...data, experimentId } });
}

export async function updateVariant(
  shopId: string,
  experimentId: string,
  variantId: string,
  input: UpdateVariantInput,
) {
  const data = updateVariantSchema.parse(input);
  const experiment = await getEditableExperiment(shopId, experimentId);

  const variant = experiment.variants.find((v) => v.id === variantId);
  if (!variant) {
    throw new ExperimentError("Variant not found");
  }

  if (data.weight !== undefined) {
    const otherWeights = experiment.variants
      .filter((v) => v.id !== variantId)
      .map((v) => v.weight);
    assertWeightsWithinBudget([...otherWeights, data.weight]);
  }

  return prisma.variant.update({ where: { id: variantId }, data });
}

export async function deleteVariant(
  shopId: string,
  experimentId: string,
  variantId: string,
) {
  const experiment = await getEditableExperiment(shopId, experimentId);
  const variant = experiment.variants.find((v) => v.id === variantId);
  if (!variant) {
    throw new ExperimentError("Variant not found");
  }
  await prisma.variant.delete({ where: { id: variantId } });
}
