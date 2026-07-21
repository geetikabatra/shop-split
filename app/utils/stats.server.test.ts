import { describe, expect, it } from "vitest";
import { MIN_SAMPLE_SIZE_PER_VARIANT, twoProportionZTest } from "./stats.server";

describe("twoProportionZTest", () => {
  it("returns null when either sample is below the minimum size", () => {
    expect(twoProportionZTest(5, MIN_SAMPLE_SIZE_PER_VARIANT - 1, 5, 100)).toBeNull();
    expect(twoProportionZTest(5, 100, 5, MIN_SAMPLE_SIZE_PER_VARIANT - 1)).toBeNull();
  });

  it("returns a result once both samples meet the minimum size", () => {
    expect(
      twoProportionZTest(5, MIN_SAMPLE_SIZE_PER_VARIANT, 5, MIN_SAMPLE_SIZE_PER_VARIANT),
    ).not.toBeNull();
  });

  it("reports z=0 and p=1 when conversion rates are identical", () => {
    const result = twoProportionZTest(50, 100, 50, 100)!;
    expect(result.zScore).toBeCloseTo(0, 10);
    // erf() is an approximation (~1.5e-7 max error), so p only converges to
    // 1 to that precision, not exactly.
    expect(result.pValue).toBeCloseTo(1, 6);
    expect(result.significantAt95).toBe(false);
  });

  it("is symmetric: swapping A and B negates z but keeps the same p-value", () => {
    const ab = twoProportionZTest(20, 200, 40, 200)!;
    const ba = twoProportionZTest(40, 200, 20, 200)!;
    expect(ab.zScore).toBeCloseTo(-ba.zScore, 10);
    expect(ab.pValue).toBeCloseTo(ba.pValue, 10);
  });

  it("flags a large, well-powered difference as significant at 99%", () => {
    // 5% vs 25% conversion rate on 1000 visitors each -- an obvious win.
    const result = twoProportionZTest(50, 1000, 250, 1000)!;
    expect(result.significantAt95).toBe(true);
    expect(result.significantAt99).toBe(true);
    expect(result.pValue).toBeLessThan(0.0001);
  });

  it("does not flag a tiny difference on a modest sample as significant", () => {
    // 10% vs 11% conversion rate on 100 visitors each -- noise-level difference.
    const result = twoProportionZTest(10, 100, 11, 100)!;
    expect(result.significantAt95).toBe(false);
  });

  it("handles identical zero conversions without producing NaN", () => {
    const result = twoProportionZTest(0, MIN_SAMPLE_SIZE_PER_VARIANT, 0, MIN_SAMPLE_SIZE_PER_VARIANT)!;
    expect(Number.isNaN(result.zScore)).toBe(false);
    expect(Number.isNaN(result.pValue)).toBe(false);
  });
});
