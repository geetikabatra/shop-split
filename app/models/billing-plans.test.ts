import { describe, expect, it } from "vitest";
import { FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT, getMaxActiveExperiments, GROWTH_PLAN } from "./billing-plans";

describe("getMaxActiveExperiments", () => {
  it("returns the free tier limit for null (no active subscription)", () => {
    expect(getMaxActiveExperiments(null)).toBe(FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT);
  });

  it("returns unlimited (null) for the Growth plan", () => {
    expect(getMaxActiveExperiments(GROWTH_PLAN)).toBeNull();
  });

  it("falls back to the free tier limit for an unrecognized plan name", () => {
    expect(getMaxActiveExperiments("Some Future Plan")).toBe(FREE_PLAN_ACTIVE_EXPERIMENT_LIMIT);
  });
});
