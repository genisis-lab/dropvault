import { describe, expect, it } from "vitest";
import { signupConfirmation } from "./signup";

describe("sign-up confirmation", () => {
  it("stays quiet when the new account is already signed in", () => {
    expect(
      signupConfirmation({ signedIn: true, approvalRequired: true }),
    ).toBeNull();
  });

  it("asks for verification without promising a review in open mode", () => {
    const message = signupConfirmation({
      signedIn: false,
      approvalRequired: false,
    });
    expect(message).toContain("Check your inbox");
    expect(message).not.toContain("administrator");
  });

  it("mentions the admin review only when approval is required", () => {
    expect(
      signupConfirmation({ signedIn: false, approvalRequired: true }),
    ).toContain("An administrator will then review your access request.");
    expect(
      signupConfirmation({ signedIn: false, approvalRequired: null }),
    ).not.toContain("administrator");
  });
});
