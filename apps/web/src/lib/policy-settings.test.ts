// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  changedPolicySettings,
  policySettingChanges,
} from "./policy-settings";

describe("workspace policy changes", () => {
  const current = {
    defaultTheme: "light",
    publicSharingEnabled: "true",
    rolePermissions: "",
  };

  it("sends only the theme when the owner changes only the default theme", () => {
    const next = { ...current, defaultTheme: "dark" };

    expect(changedPolicySettings(current, next)).toEqual({
      defaultTheme: "dark",
    });
    expect(policySettingChanges(current, next)).toEqual([
      {
        key: "defaultTheme",
        before: "light",
        after: "dark",
      },
    ]);
  });

  it("retains security changes when they are actually edited", () => {
    const next = {
      ...current,
      defaultTheme: "dark",
      publicSharingEnabled: "false",
    };

    expect(changedPolicySettings(current, next)).toEqual({
      defaultTheme: "dark",
      publicSharingEnabled: "false",
    });
  });
});
