import { describe, expect, it } from "vitest";
import { getClientIp, isRateLimited } from "./rate-limit.server";

describe("isRateLimited", () => {
  it("allows requests under the limit and blocks once exceeded", () => {
    const key = `test-key-${Math.random()}`;
    let blocked = false;
    for (let i = 0; i < 31; i++) {
      blocked = isRateLimited(key);
    }
    expect(blocked).toBe(true);
  });

  it("tracks separate keys independently", () => {
    const keyA = `test-a-${Math.random()}`;
    const keyB = `test-b-${Math.random()}`;
    expect(isRateLimited(keyA)).toBe(false);
    expect(isRateLimited(keyB)).toBe(false);
  });
});

describe("getClientIp", () => {
  it("reads the first address from x-forwarded-for", () => {
    const request = new Request("https://example.com", {
      headers: { "x-forwarded-for": "203.0.113.1, 10.0.0.1" },
    });
    expect(getClientIp(request)).toBe("203.0.113.1");
  });

  it("falls back to 'unknown' when the header is absent", () => {
    const request = new Request("https://example.com");
    expect(getClientIp(request)).toBe("unknown");
  });
});
