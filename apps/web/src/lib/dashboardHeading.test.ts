import { describe, expect, it } from "vitest";
import { dashboardHeading, dashboardSubtitle } from "./dashboardHeading";

const base = {
  search: "",
  greet: true,
  firstName: "Olivia",
  isNewAccount: false,
  title: "My Drive",
};

describe("dashboard heading", () => {
  it("welcomes a returning user back", () => {
    expect(dashboardHeading(base)).toBe("Welcome back, Olivia");
  });

  it("does not say 'back' to a brand new account", () => {
    expect(dashboardHeading({ ...base, isNewAccount: true })).toBe(
      "Welcome, Olivia",
    );
  });

  it("falls back to the product name without a first name", () => {
    expect(dashboardHeading({ ...base, firstName: "" })).toBe(
      "Welcome to Dropvault",
    );
  });

  it("uses the folder or section title outside the greeting", () => {
    expect(dashboardHeading({ ...base, greet: false, title: "Trips" })).toBe(
      "Trips",
    );
  });

  it("labels any search as results, wherever it was typed", () => {
    expect(dashboardHeading({ ...base, search: " beach " })).toBe(
      "Search results",
    );
    expect(
      dashboardHeading({ ...base, greet: false, search: "beach" }),
    ).toBe("Search results");
    expect(dashboardHeading({ ...base, search: "   " })).toBe(
      "Welcome back, Olivia",
    );
  });
});

describe("dashboard subtitle", () => {
  it("counts items in the vault", () => {
    expect(
      dashboardSubtitle({ search: "", itemCount: 1, firstName: "Olivia" }),
    ).toBe("1 item · Olivia's vault");
    expect(
      dashboardSubtitle({ search: "", itemCount: 7, firstName: "" }),
    ).toBe("7 items");
  });

  it("counts results and echoes the trimmed query", () => {
    expect(
      dashboardSubtitle({ search: " beach ", itemCount: 1, firstName: "O" }),
    ).toBe("1 result for “beach”");
    expect(
      dashboardSubtitle({ search: "zz", itemCount: 0, firstName: "O" }),
    ).toBe("0 results for “zz”");
  });
});
