import { describe, expect, it } from "vitest";
import { notificationDestination } from "./notificationTarget";

describe("notificationDestination", () => {
  it("routes uploads to the drive and expiry warnings to Expiring soon", () => {
    expect(notificationDestination({ type: "upload_complete" })).toEqual({
      kind: "drive",
    });
    expect(notificationDestination({ type: "expiry_warning" })).toEqual({
      kind: "expiring",
    });
  });
  it("routes moderation work to the matching admin section", () => {
    expect(notificationDestination({ type: "file_report" })).toEqual({
      kind: "admin",
      section: "flags",
    });
    expect(notificationDestination({ type: "signup_approval" })).toEqual({
      kind: "admin",
      section: "users",
    });
    expect(
      notificationDestination({
        type: "limit_request",
        targetType: "limit_request",
      }),
    ).toEqual({ kind: "admin", section: "limit-requests" });
  });
  it("leaves unknown notifications informational", () => {
    expect(notificationDestination({ type: "something_new" })).toBeNull();
  });
});
