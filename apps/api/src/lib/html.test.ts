import { describe, expect, it } from "vitest";
import { jsonForInlineScript } from "./html";

describe("jsonForInlineScript", () => {
  it("cannot terminate the surrounding script element", () => {
    const encoded = jsonForInlineScript({
      metadata: "</script><script>globalThis.pwned=true</script>",
    });

    expect(encoded).not.toContain("<");
    expect(JSON.parse(encoded)).toEqual({
      metadata: "</script><script>globalThis.pwned=true</script>",
    });
  });

  it("escapes JavaScript line separators", () => {
    const encoded = jsonForInlineScript({ value: "a\u2028b\u2029c" });
    expect(encoded).toContain("\\u2028");
    expect(encoded).toContain("\\u2029");
    expect(JSON.parse(encoded)).toEqual({ value: "a\u2028b\u2029c" });
  });
});
