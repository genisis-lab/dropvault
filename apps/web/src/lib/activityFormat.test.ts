import { describe, expect, it } from "vitest";
import { activityLabel, browserSummary } from "./activityFormat";

describe("activity labels", () => {
  it("uses plain language for known actions", () => {
    expect(activityLabel("file.trash")).toBe("Moved a file to Trash");
    expect(activityLabel("user.approve")).toBe("Approved an account");
  });
  it("makes unknown actions readable", () => {
    expect(activityLabel("team.member_add")).toBe("Team member add");
    expect(activityLabel("")).toBe("Unknown action");
  });
});

describe("browser summary", () => {
  it("shortens common user agents", () => {
    expect(
      browserSummary(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Linux");
    expect(
      browserSummary(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iOS");
    expect(
      browserSummary(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      browserSummary(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:131.0) Gecko/20100101 Firefox/131.0",
      ),
    ).toBe("Firefox on macOS");
    expect(browserSummary(null)).toBe("Unknown browser");
  });
});
