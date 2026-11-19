# VOLO-242: Certificates and Ratings checkboxes

## Intent
Replace the free-text Certificates and Ratings inputs with independent, optional multi-select checkbox groups using the exact seven certificate labels and three rating labels in VOLO-242. Apply this to onboarding and profile editing, which share ProfileForm.

## Approach
Keep the existing profiles.certificates and profiles.ratings text[] columns and store the full requested labels. Existing database bounds, generated types, row-level security, directory RPCs, and shared profile display already support label arrays. This keeps directory substring searches working for codes and full names without an unnecessary schema migration.

Alternatives considered: storing only codes would require display mapping and changes to full-name searches; replacing the arrays with enums or lookup tables would require a migration and an explicit policy for older free-text values. Neither is needed for this change.

## Existing data
Recognize unambiguous existing aliases (for example Private pilot and Instrument) as their matching checkbox options. Preserve unknown legacy labels as visibly checked, removable options; never silently drop them during an unrelated profile edit. Do not guess ambiguous aliases or recategorize saved values between Certificates and Ratings. No production data rewrite is proposed.

## Implementation scope
- Centralize the exact option labels and any explicit alias mappings.
- Render accessible fieldsets, legends, labeled checkboxes, group errors, and keyboard focus targets.
- Preserve array boundaries, including embedded CR/LF in legacy labels, using encoded checkbox values distinct from old textarea submissions.
- Read repeated FormData entries on both client and server; preserve every selection after validation errors and successful saves. No selections must save as empty arrays.
- Keep server validation authoritative, retain existing data bounds and owner authorization, and preserve backward-compatible legacy data handling.
- Review shared PilotDetails usage in own profile, directory cards, network profiles, and flight/connection views. Ensure canonical labels and legacy values render safely.
- Review directory filtering and pagination against the saved labels, including abbreviations and descriptive names.

## Verification
Run focused profile validation/save/onboarding/edit tests, directory and network profile tests, and relevant downstream profile consumers. Add behavior coverage where needed for repeated checkbox values, save/reopen, clearing groups, failure recovery, legacy preservation, and permissions. Run type checking and lint for changed code. Inspect whether database tests require updates; test relevant database behavior when a local database is available. Do not claim live database or production verification from fixtures.

## Delivery
Use a feature/ branch, preserve existing unrelated workspace changes, and verify with a Netlify Deploy Preview when available. Keep preview and production verification separate; production publication remains user-controlled. No production schema or data change is currently expected, subject to implementation findings.
