// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  changedPolicySettings,
  policySettingChanges,
} from "./policy-settings";

describe("workspace policy changes", () => {
  const current = {
    defaultTheme: "neubrutalism",
    publicSharingEnabled: "true",
    rolePermissions: "",
  };

  it("sends only the theme when the owner changes only the default theme", () => {
    const next = { ...current, defaultTheme: "pressroom" };

    expect(changedPolicySettings(current, next)).toEqual({
      defaultTheme: "pressroom",
    });
    expect(policySettingChanges(current, next)).toEqual([
      {
        key: "defaultTheme",
        before: "neubrutalism",
        after: "pressroom",
      },
    ]);
  });

  it("retains security changes when they are actually edited", () => {
    const next = {
      ...current,
      defaultTheme: "pressroom",
      publicSharingEnabled: "false",
    };

    expect(changedPolicySettings(current, next)).toEqual({
      defaultTheme: "pressroom",
      publicSharingEnabled: "false",
    });
  });
});
