import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";
import fs from "node:fs";
import path from "node:path";

// Loads and evaluates the *actual* shipped script, not a reimplementation --
// this is what caught real bugs during live testing this session (e.g. the
// Buy it now gap), so a test that exercised a separate copy of the logic
// would risk passing while the real script diverges.
const SCRIPT_PATH = path.resolve(
  __dirname,
  "../../extensions/shopsplit-variants/assets/shopsplit-loader.js",
);
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, "utf8");

const EXPERIMENT_ID = "exp_test_1";
const VARIANTS = [
  { id: "var_a", name: "A", isControl: true, weight: 50, content: JSON.stringify({ text: "A" }) },
  { id: "var_b", name: "B", isControl: false, weight: 50, content: JSON.stringify({ text: "B" }) },
];

function makeFetchMock(goal: string) {
  return async (input: unknown) => {
    const url = String(input);
    if (url.includes("/apps/shopsplit/config")) {
      return {
        ok: true,
        json: async () => ({ experiment: { id: EXPERIMENT_ID, goal, variants: VARIANTS } }),
      };
    }
    // /apps/shopsplit/event, /cart/update.js, /cart/add.js -- don't care
    // about the response shape for these tests, just that calls succeed.
    return { ok: true, json: async () => ({}) };
  };
}

const BLOCK_HTML =
  '<div data-shopsplit-block data-shopsplit-target-type="PRODUCT_PAGE" style="visibility: hidden;">' +
  '<span data-shopsplit-content>control text</span>' +
  "</div>";

/** Runs the real script in a fresh jsdom window and waits for it to settle. */
async function runLoaderOnce(existingCookie: string | undefined, goal = "ADD_TO_CART") {
  const dom = new JSDOM(`<!DOCTYPE html><body>${BLOCK_HTML}</body>`, {
    url: "https://shopsplit-test.myshopify.com/products/test",
    runScripts: "dangerously",
  });
  if (existingCookie) {
    dom.window.document.cookie = existingCookie;
  }
  dom.window.fetch = makeFetchMock(goal) as typeof fetch;

  // Inject as a real <script> element -- matches how the theme block
  // actually loads it (a <script src="...">), and avoids the scoping
  // quirks of calling window.eval() directly.
  const scriptEl = dom.window.document.createElement("script");
  scriptEl.textContent = SCRIPT_SOURCE;
  dom.window.document.body.appendChild(scriptEl);

  // Flush the microtask/macrotask queue so the fetch().then() chain settles.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const block = dom.window.document.querySelector("[data-shopsplit-block]")!;
  const cookieMatch = dom.window.document.cookie.match(/shopsplit_vid=([^;]+)/);
  return {
    variantId: block.getAttribute("data-shopsplit-variant-id"),
    visitorId: cookieMatch ? decodeURIComponent(cookieMatch[1]) : null,
    visibility: (block as HTMLElement).style.visibility,
  };
}

describe("shopsplit-loader.js bucketing", () => {
  it("reveals the block and applies a variant", async () => {
    const result = await runLoaderOnce(undefined);
    expect(result.variantId).toMatch(/^var_[ab]$/);
    expect(result.visibility).toBe("");
  });

  it("generates a visitor cookie when none exists", async () => {
    const result = await runLoaderOnce(undefined);
    expect(result.visitorId).toBeTruthy();
  });

  it("is sticky: the same visitorId always resolves to the same variant", async () => {
    const first = await runLoaderOnce(undefined);
    // Simulate a second page load carrying over the same cookie.
    const second = await runLoaderOnce(`shopsplit_vid=${encodeURIComponent(first.visitorId!)}`);
    const third = await runLoaderOnce(`shopsplit_vid=${encodeURIComponent(first.visitorId!)}`);

    expect(second.variantId).toBe(first.variantId);
    expect(third.variantId).toBe(first.variantId);
  });

  it(
    "splits many distinct visitors roughly according to variant weights",
    async () => {
      const counts: Record<string, number> = { var_a: 0, var_b: 0 };
      const SAMPLE_SIZE = 100;

      for (let i = 0; i < SAMPLE_SIZE; i++) {
        const result = await runLoaderOnce(undefined);
        counts[result.variantId!] = (counts[result.variantId!] ?? 0) + 1;
      }

      // Both weights are 50, so with 100 samples either side landing below
      // ~30% (30/100) would indicate a real skew, not just sampling noise.
      expect(counts.var_a).toBeGreaterThan(30);
      expect(counts.var_b).toBeGreaterThan(30);
      expect(counts.var_a + counts.var_b).toBe(SAMPLE_SIZE);
    },
    15000,
  );
});
