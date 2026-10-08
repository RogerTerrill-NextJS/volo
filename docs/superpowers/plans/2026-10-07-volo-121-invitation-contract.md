# VOLO-121 Invitation Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Preserve the user's previously selected native execution method.

**Goal:** Publish the approved invitation-only account activation contract and align downstream Jira tickets, without implementing their auth flows.

**Architecture:** The approved spec is the detailed source of truth. Existing callback and session documentation link to it and summarize its decisions; Jira carries implementation ownership and dependency corrections.

**Tech Stack:** Markdown documentation and Jira. Existing Next.js 16.3.8 / Supabase interfaces are described, not changed.

**Spec:** `docs/superpowers/specs/2026-10-07-volo-121-invitation-contract-design.md`

## Global Constraints

- Application invitations do not expire; provider tokens and setup authorizations still have finite lifetimes.
- Invitations are specific to one email address. MVP issuance is admin-only; member invitations are future work.
- Production publishing stays locked. Use feature/ branches, Deploy Previews and production only, with no staging environment.
- Previews share production Supabase; write tests use owned disposable local resources.
- No routes, schema, credentials, email sends, hosted settings or production release changes in VOLO-121.
- No downstream ticket is Done merely because this contract is merged.

## Review Focus

Manual document review covers these input classes; runtime assertions belong to their implementation tickets:

1. An old eligible invitation must remain usable through a fresh provider link, rather than silently expire.
2. An email scanner must not consume an invitation or activate membership.
3. Existing/disabled accounts must not be reset, promoted or re-enabled by invitation acceptance.
4. A general login/recovery session must not be treated as invitation setup authority.
5. Ambiguous provider outcomes or concurrent completion must not grant premature access or duplicate identities.

## Task 1: Publish the contract through existing documentation

**Files:**
- Modify: `docs/auth-callbacks.md`
- Modify: `docs/session-integration.md`
- Read: the approved spec above.

**Interfaces:**
- Consumes: approved lifecycle, fixed `/auth/confirm` and `/account/setup` routes, non-expiring invitation policy, explicit verification POST and server-owned membership/redemption boundary.
- Produces: durable links and concise summaries for downstream implementers. No new runtime API.

- [ ] Read both existing documents and locate invitation/session handoffs.
- [ ] Add a linked invitation activation handoff in `docs/auth-callbacks.md`, distinguishing passive GET/HEAD from explicit verification POST, invitation eligibility from provider-token expiry, and admin-only MVP issuance from future member invitations.
- [ ] Link the spec from the remaining feature work section in `docs/session-integration.md`. State that callback implementation, local schema/admission/redemption and hosted activation remain downstream.
- [ ] Review all five Review Focus items against the linked spec; ensure each has an explicit policy and owning ticket. Do not describe a documented policy as implemented behavior.
- [ ] Run `git diff --check`; expected exit 0. Verify both relative spec links resolve to an existing file. No new automated tests are needed for these documentation-only changes.
- [ ] Commit the documentation handoff on `feature/volo-121-invitation-contract`.

## Task 2: Align Jira acceptance criteria and prepare review

**External artifacts:** VOLO-121/122/124/125/126 and VOLO-27/28/29/30.

**Interfaces:**
- Consumes: committed approved spec and existing Jira descriptions.
- Produces: preserved ticket descriptions with corrected policy, explicit ownership and a PR review record.

- [ ] Read each affected Jira description before editing. Preserve unrelated acceptance criteria.
- [ ] Add the non-expiring application invitation policy to VOLO-27/28/29/30; distinguish expiring provider links from eligibility. Preserve server-only authority, direct API gating and one-time redemption requirements.
- [ ] Correct any conflicting VOLO-122/124/125 expiry language; require rejection of expired tokens/setup sessions, never invitation age alone. Add the future member-invitation boundary to issuance handoff without implementing it.
- [ ] Record the dependency order and contract link on VOLO-121 and VOLO-126. Review focus coverage belongs to VOLO-122 (scanner/setup), VOLO-124/30 (membership/concurrency), VOLO-125 (real-service evidence) and VOLO-29 (resend/provider outcomes).
- [ ] Read back affected descriptions and confirm policy/ownership preservation.
- [ ] Perform one whole-branch document review using the normal native review workflow; fix material contradictions, verify links and whitespace again.
- [ ] Prepare a documentation PR with the approved choices, manual validation and explicit downstream scope. Push only the feature branch; do not merge or publish production.
- [ ] Keep VOLO-121 In Progress until user merge and verified main ancestry; record the PR and handoff evidence in Jira.

## Plan self-review

All VOLO-121 acceptance criteria are covered by the approved detailed spec and these documentation/Jira publication tasks. Runtime features are intentionally owned by later tickets, so this plan must not expand into their implementation. Manual consistency checks are proportionate to the documentation change; runtime security tests remain explicit downstream gates.
