import { describe, expect, it } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { fileKeyRecovery, files, twoFactor, vaultPurgeJobs } from "./schema";

describe("Better Auth two-factor schema", () => {
  it("includes the account-lockout columns used during every TOTP attempt", () => {
    const columns = getTableColumns(twoFactor);

    expect(columns.failedVerificationCount.name).toBe(
      "failedVerificationCount",
    );
    expect(columns.lockedUntil.name).toBe("lockedUntil");
  });
});

describe("encrypted file recovery schema", () => {
  it("keeps duress tombstones and recovery envelopes in dedicated columns", () => {
    const fileColumns = getTableColumns(files);
    const recoveryColumns = getTableColumns(fileKeyRecovery);
    const purgeColumns = getTableColumns(vaultPurgeJobs);

    expect(fileColumns.purgeRequestedAt.name).toBe("purge_requested_at");
    expect(fileColumns.purgeReason.name).toBe("purge_reason");
    expect(recoveryColumns.accountEnvelope.name).toBe("account_envelope");
    expect(recoveryColumns.passwordEnvelope.name).toBe("password_envelope");
    expect(recoveryColumns.passwordVerifier.name).toBe("password_verifier");
    expect(recoveryColumns.duressVerifier.name).toBe("duress_verifier");
    expect(recoveryColumns.credentialSalt.name).toBe("credential_salt");
    expect(purgeColumns.nextAttemptAt.name).toBe("next_attempt_at");
  });
});
