import { describe, expect, it } from "vitest";
import { normalizeAdminRole } from "./admin";

describe("administrative roles", () => {
  it.each(["owner", "admin", "moderator", "auditor"] as const)(
    "keeps the %s role",
    (role) => expect(normalizeAdminRole(role)).toBe(role),
  );

  it("migrates the legacy viewer role to auditor", () => {
    expect(normalizeAdminRole("viewer")).toBe("auditor");
  });

  it("fails closed to read-only access for an unknown role", () => {
    expect(normalizeAdminRole("root")).toBe("auditor");
  });
});
