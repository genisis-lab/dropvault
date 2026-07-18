import { describe, expect, it } from "vitest";
import { formatBytes, timeLeft } from "./format";

describe("formatBytes", () => {
  it("handles zero", () => expect(formatBytes(0)).toBe("0 B"));
  it("formats raw bytes without decimals", () =>
    expect(formatBytes(512)).toBe("512 B"));
  it("formats kilobytes", () => expect(formatBytes(2048)).toBe("2.0 KB"));
  it("formats one gigabyte", () =>
    expect(formatBytes(1073741824)).toBe("1.0 GB"));
});

const nowSecs = () => Math.floor(Date.now() / 1000);

describe("timeLeft", () => {
  it("marks past timestamps as expired and urgent", () => {
    const r = timeLeft(nowSecs() - 10);
    expect(r.label).toBe("expired");
    expect(r.urgent).toBe(true);
  });
  it("reports days remaining without urgency", () => {
    const r = timeLeft(nowSecs() + 3 * 86400);
    expect(r.label).toContain("d");
    expect(r.urgent).toBe(false);
  });
  it("is urgent when only minutes remain", () => {
    const r = timeLeft(nowSecs() + 120);
    expect(r.label).toContain("m left");
    expect(r.urgent).toBe(true);
  });
});
