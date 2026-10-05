// IF-01 v0 guard (owner: INT): every registered endpoint has a fixture of the declared shape, and no fixture is orphaned.
import { describe, expect, it } from "vitest";
import { ENDPOINTS } from "../../../packages/contracts/api";
import { FIXTURES } from "../../../packages/contracts/fixtures";

describe("contracts v0", () => {
  it.each(ENDPOINTS.map((e) => [`${e.method} ${e.path}`, e] as const))("%s has a fixture", (_name, e) => {
    expect(FIXTURES).toHaveProperty([e.fixture]);
    expect(Array.isArray(FIXTURES[e.fixture])).toBe(e.shape === "array");
  });

  it("has no orphan fixtures", () => {
    const used = new Set(ENDPOINTS.map((e) => e.fixture));
    expect(Object.keys(FIXTURES).filter((f) => !used.has(f))).toEqual([]);
  });
});
