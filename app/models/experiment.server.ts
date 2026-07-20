import { z } from "zod";
import prisma from "../db.server";

export const EXPERIMENT_STATUSES = [
  "DRAFT",
  "RUNNING",
  "PAUSED",
  "COMPLETED",
] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

export const EXPERIMENT_GOALS = ["ADD_TO_CART", "PURCHASE"] as const;
export type ExperimentGoal = (typeof EXPERIMENT_GOALS)[number];

export const TARGET_TYPES = ["PRODUCT_PAGE", "BANNER"] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

const ALLOWED_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  DRAFT: ["RUNNING"],
  RUNNING: ["PAUSED", "COMPLETED"],
  PAUSED: ["RUNNING", "COMPLETED"],
  COMPLETED: [],
};

export class ExperimentError extends Error {}

export const createExperimentSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  targetType: z.enum(TARGET_TYPES),
  targetResourceId: z.string().trim().min(1).optional(),
  goal: z.enum(EXPERIMENT_GOALS),
});
export type CreateExperimentInput = z.infer<typeof createExperimentSchema>;

export const updateExperimentSchema = createExperimentSchema.partial();
export type UpdateExperimentInput = z.infer<typeof updateExperimentSchema>;

export function canTransition(
  from: ExperimentStatus,
  to: ExperimentStatus,
): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export async function listExperiments(shopId: string) {
  return prisma.experiment.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: { variants: true },
  });
}

export async function getExperiment(shopId: string, id: string) {
  const experiment = await prisma.experiment.findFirst({
    where: { id, shopId },
    include: { variants: true },
  });
  if (!experiment) {
    throw new ExperimentError("Experiment not found");
  }
  return experiment;
}

export async function createExperiment(
  shopId: string,
  input: CreateExperimentInput,
) {
  const data = createExperimentSchema.parse(input);
  return prisma.experiment.create({
    data: { ...data, shopId, status: "DRAFT" satisfies ExperimentStatus },
  });
}

export async function updateExperiment(
  shopId: string,
  id: string,
  input: UpdateExperimentInput,
) {
  const data = updateExperimentSchema.parse(input);
  const experiment = await getExperiment(shopId, id);
  if (experiment.status !== "DRAFT") {
    throw new ExperimentError(
      "Only draft experiments can be edited. Pause or complete a running experiment before changing its setup.",
    );
  }
  return prisma.experiment.update({ where: { id }, data });
}

/**
 * Moving DRAFT -> RUNNING is the one transition that must validate the
 * variant setup, since that's the last checkpoint before real traffic
 * starts being bucketed.
 */
export async function transitionExperimentStatus(
  shopId: string,
  id: string,
  nextStatus: ExperimentStatus,
) {
  const experiment = await getExperiment(shopId, id);
  const currentStatus = experiment.status as ExperimentStatus;

  if (!canTransition(currentStatus, nextStatus)) {
    throw new ExperimentError(
      `Cannot move experiment from ${currentStatus} to ${nextStatus}`,
    );
  }

  if (nextStatus === "RUNNING" && currentStatus === "DRAFT") {
    if (experiment.variants.length < 2) {
      throw new ExperimentError(
        "An experiment needs at least two variants (including a control) before it can run.",
      );
    }
    if (!experiment.variants.some((v) => v.isControl)) {
      throw new ExperimentError(
        "An experiment needs a control variant before it can run.",
      );
    }
    const weightSum = experiment.variants.reduce((sum, v) => sum + v.weight, 0);
    if (weightSum !== 100) {
      throw new ExperimentError(
        `Variant weights must sum to 100 before starting (currently ${weightSum}).`,
      );
    }
  }

  return prisma.experiment.update({
    where: { id },
    data: {
      status: nextStatus,
      startedAt:
        nextStatus === "RUNNING" && !experiment.startedAt
          ? new Date()
          : experiment.startedAt,
      endedAt: nextStatus === "COMPLETED" ? new Date() : experiment.endedAt,
    },
  });
}
