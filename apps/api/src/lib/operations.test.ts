import { describe, expect, it } from "vitest";
import {
  alertConditions,
  clientPlatform,
  normalizeThresholds,
  OPERATION_DEFAULTS,
} from "./operations";
describe("operational alerts", () => {
  it("does not turn a small sample into a failure-rate alert", () => {
    expect(
      alertConditions(
        { attempts: 2, failures: 2, stale: false, growthBytes: 0 },
        OPERATION_DEFAULTS,
      )["upload-failures"],
    ).toBe(false);
    expect(
      alertConditions(
        { attempts: 20, failures: 3, stale: false, growthBytes: 0 },
        OPERATION_DEFAULTS,
      )["upload-failures"],
    ).toBe(true);
  });
  it("resolves conditions after recovery and separates storage from cleanup", () => {
    expect(
      alertConditions(
        { attempts: 20, failures: 0, stale: false, growthBytes: 0 },
        OPERATION_DEFAULTS,
      ),
    ).toEqual({
      "upload-failures": false,
      "cleanup-overdue": false,
      "storage-growth": false,
    });
    expect(
      alertConditions(
        { attempts: 0, failures: 0, stale: true, growthBytes: 11 * 1024 ** 3 },
        OPERATION_DEFAULTS,
      ),
    ).toEqual({
      "upload-failures": false,
      "cleanup-overdue": true,
      "storage-growth": true,
    });
  });
  it("bounds thresholds and rejects non-finite values", () => {
    expect(
      normalizeThresholds({
        failurePercent: NaN,
        minAttempts: -1,
        staleHours: 0,
        storageGrowthGiB: Infinity,
      }),
    ).toEqual({ ...OPERATION_DEFAULTS, minAttempts: 1, staleHours: 2 });
  });
  it("records coarse platform names without retaining the user agent", () => {
    expect(clientPlatform("Mozilla iPhone Version/18 Safari/604")).toEqual({
      browser: "Safari",
      os: "iOS",
    });
    expect(clientPlatform("Mozilla iPhone CriOS/130 Safari/604")).toEqual({
      browser: "Chrome",
      os: "iOS",
    });
  });
});
