import { describe, expect, it } from "vitest";
import { applyRequestedSettingChanges } from "./settings";

type Key = "defaultTheme" | "publicSharingEnabled" | "rolePermissions";
const keys: Key[] = [
  "defaultTheme",
  "publicSharingEnabled",
  "rolePermissions",
];
const current: Record<Key, string> = {
  defaultTheme: "neubrutalism",
  publicSharingEnabled: "true",
  rolePermissions: "",
};

function normalize(key: Key, value: unknown): string {
  if (key === "rolePermissions") return '{"manageUsers":"admin"}';
  return String(value ?? "");
}

describe("requested workspace settings", () => {
  it("does not renormalize unchanged policy values in a full theme request", () => {
    const result = applyRequestedSettingChanges(
      current,
      { ...current, defaultTheme: "pressroom" },
      keys,
      normalize,
    );

    expect(result).toEqual({
      ...current,
      defaultTheme: "pressroom",
    });
  });

  it("normalizes policy values that were actually changed", () => {
    const result = applyRequestedSettingChanges(
      current,
      { rolePermissions: "unsafe-client-value" },
      keys,
      normalize,
    );

    expect(result.rolePermissions).toBe('{"manageUsers":"admin"}');
  });
});
