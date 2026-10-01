import { describe, expect, it } from "vitest";
import { adminSectionFromHash, isAdminHash } from "./adminRoute";

describe("admin route hash", () => {
  it("recognizes the admin console and its sections", () => {
    expect(isAdminHash("#admin")).toBe(true);
    expect(isAdminHash("#admin/users")).toBe(true);
    expect(isAdminHash("#administrator")).toBe(false);
    expect(isAdminHash("")).toBe(false);
  });
  it("reads the section name", () => {
    expect(adminSectionFromHash("#admin/files")).toBe("files");
    expect(adminSectionFromHash("#admin")).toBeNull();
    expect(adminSectionFromHash("#admin/")).toBeNull();
  });
});
