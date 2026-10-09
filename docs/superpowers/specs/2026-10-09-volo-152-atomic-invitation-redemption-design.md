# VOLO-152: atomic invitation redemption

## Outcome and scope

An eligible invited recipient gains member access only when one PostgreSQL
transaction both creates membership and marks the invitation redeemed. Failure
saves neither change. Invitation age never expires eligibility.

The approved VOLO-121 activation and VOLO-127 persistence contracts remain
authoritative. This implements their redemption operation using VOLO-122's real
setup authority. VOLO-124 owns password operations and recording server-observed
password success; VOLO-123 owns the form. This ticket adds no Auth network calls,
password handler, application route, onboarding framework, or new secret store.

## Restricted interface

Add a service-role-only `public.redeem_invitation` security-definer function with
an empty search path and fully qualified references. Revoke execution from
PUBLIC, anon and authenticated, including application administrators.

Inputs are invitation ID, expected version, setup authorization ID, setup-cookie
digest, verified subject, verified email, verified Auth session ID and configured
origin. The future server caller must obtain identity/session from verified Auth
and the digest from the opaque setup cookie. Correlation UUIDs, form fields,
editable metadata or a general login alone never constitute setup authority.
The RPC does not accept a role or a client claim of password success.

Results are minimal JSON codes: `redeemed`, `already_redeemed`, `conflict` or
`denied`. Infrastructure/database errors remain failures for the caller to map
to unavailable; never expose raw errors to the browser or treat them as success.
Generated database types must match the migrated schema. The server adapter and
full consumer handoff belong to VOLO-153, after its concurrency proof.

## Transaction and authorization

Validate required inputs and lock the invitation first, matching the lock order
used by setup creation, renewal and expiry cleanup. Recheck the expected version,
bound and verified subject, recipient email and terminal state under the lock.

Lock/check the matching separate setup row: exact ID/digest, invitation/version,
subject, session and origin, with its original expiry still in the future. Verify
that the current Auth user remains confirmed, non-anonymous and unbanned, its
email matches the recipient, and the matching Auth session exists and has not
passed its `not_after` deadline. No expiry extension or replacement setup grant
is permitted here.

First redemption requires `password_established` and the existing complete
verification/password snapshot for that setup ID. VOLO-124 will write this
snapshot only after a successful caller-session password operation. Database
tests may create trusted fixture evidence; they do not claim to prove real Auth
password success.

Insert membership explicitly as `member` and `active`, then update the invitation
to `redeemed` with an ordered redemption timestamp. Both writes execute within
the same transaction. Never upsert, overwrite, promote, or re-enable membership.
An existing membership or a concurrent unique-key conflict must leave both
membership and invitation unchanged. Unexpected failures propagate and roll back;
a handled uniqueness conflict must also roll back the operation's writes.

## Completed retries and cleanup

After commit, the original setup row may remain until its original expiry as
completion context only. Existing setup readers already reject redeemed
invitations, so this retained row cannot authorize another password/setup step.
Existing scheduled cleanup deletes it and preserves the terminal invitation
snapshot. No additional receipt table or cleanup job is needed.

An identical retry with the same still-valid verified completion context and
redeemed invitation returns `already_redeemed` without writing anything. A wrong
subject, changed version, missing/different/expired setup context or invalid
session cannot obtain that result. It reports recorded completion, not current
application access: a membership disabled after redemption stays disabled.

VOLO-124 must reconcile completed state before repeating a password operation,
clear the browser setup cookie after successful completion and navigate freshly
to the fixed `/dashboard` destination. Normal current-membership authorization
remains the final access gate. Lost/expired completion context grants no new
authority; ordinary membership access remains independently checked.

## Verification and ownership

Reuse the current pgTAP fixtures and seeded/unseeded disposable CI database jobs.
Focused VOLO-152 checks cover restricted execution, first successful atomic
redemption, missing/wrong authority or password evidence, version/terminal-state
denial, no invitation-age expiry, existing membership preservation, a forced
failure between writes, and an identical no-write retry. Include cleanup after
redemption so retained context cannot erase the terminal snapshot.

VOLO-153 owns the broader overlapping transaction tests (identical redemption,
renewal/cleanup and existing-membership races), retry/disabled-member invariants
and the typed server adapter. Do not duplicate VOLO-125's real Auth end-to-end
suite here. VOLO-30 completion requires both subtasks; VOLO-152 alone does not
claim that concurrency or the complete signup flow has been proved.

Use the current checkout on a `feature/` branch. Preserve unrelated audit files.
There is no staging environment: only Netlify Deploy Preview and production.
Their shared hosted Supabase is not a test target. This work changes checked-in
migrations/types/tests only; hosted migration, accounts, Auth/email settings and
production publication require their separately approved operation. Keep
production publishing locked and avoid additional deployment cycles per subtask.
