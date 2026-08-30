import { describe, expect, it } from "vitest";
import { resendEmailForEvent } from "./email";

describe("Dropvault account email", () => {
  const env = { PUBLIC_APP_URL: "https://drive.builtwai.com" };

  it("builds verification and approval messages", () => {
    const verification = resendEmailForEvent(env, "verify_email", {
      email: "friend@example.com",
      name: "Friend",
      url: "https://drive.builtwai.com/api/auth/verify-email?token=safe",
    });
    const approval = resendEmailForEvent(env, "account_approved", {
      email: "friend@example.com",
      name: "Friend",
    });

    expect(verification).toMatchObject({
      to: "friend@example.com",
      subject: "Verify your email for Dropvault",
    });
    expect(verification?.text).toContain("administrator will review");
    expect(approval).toMatchObject({
      to: "friend@example.com",
      subject: "Your Dropvault account is approved",
    });
    expect(approval?.text).toContain("https://drive.builtwai.com/");
  });
});
