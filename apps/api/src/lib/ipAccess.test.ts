import { describe, expect, it } from "vitest";
import {
  banTargetsRequester,
  ipMatchesAllowlist,
  normalizeIp,
  recentIpsFrom,
} from "./ipAccess";

describe("IP access helpers", () => {
  it("detects a ban that would block the requester", () => {
    expect(banTargetsRequester("203.0.113.10", ["203.0.113.10"])).toBe(true);
    expect(
      banTargetsRequester("::ffff:203.0.113.10", ["2001:db8::1", "203.0.113.10"]),
    ).toBe(true);
    expect(banTargetsRequester("2001:0db8::0001", ["2001:db8::1"])).toBe(true);
    expect(banTargetsRequester("203.0.113.11", ["203.0.113.10"])).toBe(false);
    expect(banTargetsRequester("not an ip", ["203.0.113.10"])).toBe(false);
    expect(banTargetsRequester("203.0.113.10", [])).toBe(false);
  });

  it("normalizes IPv4, IPv6, ports, brackets, and IPv4-mapped IPv6", () => {
    expect(normalizeIp("203.0.113.10")).toBe("203.0.113.10");
    expect(normalizeIp("203.0.113.10:443")).toBe("203.0.113.10");
    expect(normalizeIp("[2001:0db8::0001]:443")).toBe("2001:db8::1");
    expect(normalizeIp("::ffff:203.0.113.10")).toBe("203.0.113.10");
  });

  it("matches allowlisted IPv4 and IPv6 addresses", () => {
    expect(ipMatchesAllowlist("203.0.113.10", ["203.0.113.10"])).toBe(true);
    expect(ipMatchesAllowlist("::ffff:203.0.113.10", ["203.0.113.10"])).toBe(
      true,
    );
    expect(ipMatchesAllowlist("2001:db8::1", ["2001:0db8::0001"])).toBe(true);
    expect(ipMatchesAllowlist("203.0.113.44", ["203.0.113.0/24"])).toBe(true);
    expect(ipMatchesAllowlist("198.51.100.44", ["203.0.113.0/24"])).toBe(false);
  });

  it("keeps recent admin IP capture normalized and deduped", () => {
    expect(
      recentIpsFrom([
        { ip: "203.0.113.10:443", createdAt: 1 },
        { ip: "::ffff:203.0.113.10", createdAt: 2 },
        { ip: "[2001:db8::1]:443", createdAt: 3 },
      ]),
    ).toEqual(["2001:db8::1", "203.0.113.10"]);
  });
});
