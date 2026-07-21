import { describe, expect, it } from "vitest";
import { clientIpInfo } from "./rateLimit";

function context(headers: Record<string, string | undefined>) {
  const lower = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    req: { header: (name: string) => lower[name.toLowerCase()] },
  };
}

describe("clientIpInfo", () => {
  it("does not let forwarding headers override Cloudflare's address", () => {
    expect(
      clientIpInfo(
        context({
          "CF-Connecting-IP": "2001:db8::10",
          "X-Forwarded-For": "198.51.100.44",
          "X-Real-IP": "203.0.113.55",
        }),
      ),
    ).toEqual({
      primary: "2001:db8::10",
      ipv4: null,
      ipv6: "2001:db8::10",
      all: ["2001:db8::10"],
    });
  });

  it("fails closed when Cloudflare's canonical header is malformed", () => {
    expect(
      clientIpInfo(
        context({
          "CF-Connecting-IP": "not-an-ip",
          "X-Forwarded-For": "198.51.100.44",
        }),
      ).primary,
    ).toBe("unknown");
  });

  it("retains proxy fallbacks for local development", () => {
    expect(
      clientIpInfo(context({ "X-Forwarded-For": "198.51.100.44" })).primary,
    ).toBe("198.51.100.44");
  });
});
