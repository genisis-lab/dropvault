import { describe, expect, it } from "vitest";
import {
  applyRequestedSettingChanges,
  DEFAULT_MAX_UPLOAD_BYTES,
  parseMaxUploadBytes,
} from "./settings";

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

describe("max upload policy", () => {
  it("uses the 1 GiB default when the setting is missing", () => {
    expect(parseMaxUploadBytes(undefined)).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });

  it("preserves explicit limits and the existing unlimited value", () => {
    expect(parseMaxUploadBytes("536870912")).toBe(536870912);
    expect(parseMaxUploadBytes("0")).toBe(0);
  });

  it("fails closed to the default for malformed settings", () => {
    expect(parseMaxUploadBytes("")).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(parseMaxUploadBytes("not-a-number")).toBe(DEFAULT_MAX_UPLOAD_BYTES);
    expect(parseMaxUploadBytes("1.5")).toBe(DEFAULT_MAX_UPLOAD_BYTES);
  });
});
