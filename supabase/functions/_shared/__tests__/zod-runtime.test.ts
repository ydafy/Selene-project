import { describe, expect, it } from "bun:test";
import { z } from "../zod-runtime.ts";

// GHSA-mrhx-c7xc-m3w5: zod < 4.6.6 parsed every element of an oversized array
// before checking its size bound, building one issue per bad element.
describe("Edge Function zod runtime", () => {
  it("rejects an oversized bounded array without parsing its elements", () => {
    const schema = z.array(z.string().uuid()).min(1).max(50);
    const oversized = Array.from({ length: 10_000 }, () => "not-a-uuid");

    const result = schema.safeParse(oversized);

    expect(result.success).toBe(false);
    expect(result.error?.issues).toHaveLength(1);
    expect(result.error?.issues[0]?.code).toBe("too_big");
  });
});
