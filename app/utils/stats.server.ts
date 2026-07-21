/** Abramowitz & Stegun 7.1.26 approximation, max error ~1.5e-7. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

function twoSidedPValue(z: number): number {
  return 2 * (1 - normalCdf(Math.abs(z)));
}

export const MIN_SAMPLE_SIZE_PER_VARIANT = 30;

export interface ZTestResult {
  /** Positive when variant B's rate is higher than variant A's. */
  zScore: number;
  pValue: number;
  confidenceLevel: number;
  significantAt95: boolean;
  significantAt99: boolean;
}

/**
 * Two-proportion z-test comparing variant B against variant A (typically
 * the control). Returns null below MIN_SAMPLE_SIZE_PER_VARIANT for either
 * side -- refusing to call a result significant on too little data is more
 * important than returning a number.
 */
export function twoProportionZTest(
  conversionsA: number,
  nA: number,
  conversionsB: number,
  nB: number,
): ZTestResult | null {
  if (nA < MIN_SAMPLE_SIZE_PER_VARIANT || nB < MIN_SAMPLE_SIZE_PER_VARIANT) {
    return null;
  }

  const pA = conversionsA / nA;
  const pB = conversionsB / nB;
  const pooled = (conversionsA + conversionsB) / (nA + nB);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));

  if (se === 0) {
    return {
      zScore: 0,
      pValue: 1,
      confidenceLevel: 0,
      significantAt95: false,
      significantAt99: false,
    };
  }

  const zScore = (pB - pA) / se;
  const pValue = twoSidedPValue(zScore);

  return {
    zScore,
    pValue,
    confidenceLevel: 1 - pValue,
    significantAt95: pValue < 0.05,
    significantAt99: pValue < 0.01,
  };
}
