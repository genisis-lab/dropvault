import { describe, expect, it } from "vitest";
import {
  credentialVaryHeader,
  isPrivateCredentialApiPath,
} from "./responseCache";

describe("private credential API cache policy", () => {
  it.each([
    "/api/account",
    "/api/account/me",
    "/api/auth/get-session",
    "/api/sessions",
    "/api/sessions/current",
  ])("matches %s", (pathname) => {
    expect(isPrivateCredentialApiPath(pathname)).toBe(true);
  });

  it.each([
    "/api/accounting",
    "/api/authors",
    "/api/session",
    "/api/theme",
    "/health",
  ])("does not overmatch %s", (pathname) => {
    expect(isPrivateCredentialApiPath(pathname)).toBe(false);
  });

  it("preserves existing dimensions and adds credential dimensions once", () => {
    expect(credentialVaryHeader("Origin, cookie")).toBe(
      "Origin, cookie, Authorization",
    );
    expect(credentialVaryHeader(null)).toBe("Cookie, Authorization");
  });

  it("preserves a wildcard Vary policy", () => {
    expect(credentialVaryHeader("*")).toBe("*");
  });
});
