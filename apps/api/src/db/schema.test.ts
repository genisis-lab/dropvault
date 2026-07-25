import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { twoFactor } from "./schema";

describe("Better Auth two-factor schema", () => {
  it("includes the account-lockout columns used during every TOTP attempt", () => {
    const columns = getTableColumns(twoFactor);

    expect(columns.failedVerificationCount.name).toBe(
      "failedVerificationCount",
    );
    expect(columns.lockedUntil.name).toBe("lockedUntil");
  });
});
