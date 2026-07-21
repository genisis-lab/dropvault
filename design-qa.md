# Neubrutalism design QA

## Compared state

- Reference: `docs/design-qa/neubrutalism-reference.png`
- Implementation: `docs/design-qa/neubrutalism-clickable-home-logo.png`
- Side-by-side comparison: `docs/design-qa/neubrutalism-clickable-home-logo-comparison.png`
- Viewport: 1440 × 1024
- State: authenticated root My Drive list with Neubrutalism active after returning from Favorites through the brand control

## Evidence

- Full desktop and focused logo comparison: `docs/design-qa/neubrutalism-clickable-home-logo-comparison.png`
- Updated implementation: `docs/design-qa/neubrutalism-clickable-home-logo.png`
- Admin default-theme editor: `docs/design-qa/admin-theme-settings.png`
- Mobile layout at 390 × 844: `docs/design-qa/neubrutalism-mobile.png`
- Quiet Drive alternate theme: `docs/design-qa/quiet-drive.png`

The latest comparison covers the full desktop shell and includes a focused brand crop. The focused crop is needed because the requested removal of the edition label and the new keyboard focus affordance are too small to judge reliably in the full view. Earlier focused screenshots remain included for the admin-only default-theme control, responsive mobile state, and Quiet Drive option.

## Comparison history

### Pass 1

- P1: the upload target was too tall and pushed the primary file list below the expected position.
- P1: recent files and storage information competed with the main list instead of supporting it.
- P2: the details overlay dimmed too much of the workspace and the panel was wider than the reference.

Changes made: converted the upload target to a desktop command strip, moved the file table ahead of recent items, removed the redundant storage breakdown from productivity themes, and narrowed the transparent details treatment.

### Final pass

- No actionable P0, P1, or P2 visual mismatches remain.
- Typography: the Dropvault wordmark retains its established weight, sizing, and blue “vault” treatment; the user-requested `NEUBRUTALISM` edition label is intentionally absent.
- Spacing and layout: removing the second line makes the brand lockup more compact without changing the sidebar grid or displacing adjacent controls.
- Colors and tokens: the cobalt, black-border, cream-canvas, and hard-shadow treatment remains unchanged.
- Image and icon fidelity: the existing Dropvault cloud icon remains sharp and correctly scaled; no image asset was replaced or approximated.
- Copy and content: the brand now reads only `Dropvault`, and the control exposes the accessible name `Go to My Drive`.
- The implementation intentionally uses live Dropvault filenames and controls, so table content differs from the generated reference while preserving its hierarchy and density.

## Interaction checks

- Opened the theme menu and switched among Neubrutalism, Quiet Drive, Light, Dark, and Sunset.
- Reset a personal override with **Use workspace default**.
- In the owner admin panel, saved Quiet Drive as the workspace default and confirmed the active UI updated immediately.
- Saved Neubrutalism as the workspace default again and confirmed it remained active after reload.
- Opened an encrypted file's detail panel in the desktop layout.
- Checked the mobile layout at 390 × 844.
- Reloaded after the final code change and confirmed there were no fresh browser console warnings or errors.
- Opened Favorites, clicked the Dropvault brand control, and confirmed My Drive became active and the root dashboard heading returned.
- Confirmed the brand control is a native button with the accessible name **Go to My Drive**, pointer affordance, hover feedback, and keyboard-visible focus styling.
- Confirmed `NEUBRUTALISM` is absent from rendered page copy.

## Final result

final result: passed

No actionable P0/P1/P2 findings remain. The edition-label difference from the source is the explicit product change requested for this iteration.
