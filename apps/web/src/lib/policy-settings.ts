export type PolicySettings = Record<string, string>;

export type PolicySettingChange = {
  key: string;
  before: string;
  after: string;
};

export function policySettingChanges(
  before: PolicySettings,
  after: PolicySettings,
): PolicySettingChange[] {
  return Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)]),
  )
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      key,
      before: before[key] ?? "",
      after: after[key] ?? "",
    }));
}

export function changedPolicySettings(
  before: PolicySettings,
  after: PolicySettings,
): PolicySettings {
  return Object.fromEntries(
    policySettingChanges(before, after).map(({ key, after: value }) => [
      key,
      value,
    ]),
  );
}
