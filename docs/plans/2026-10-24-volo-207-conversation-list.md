# VOLO-207 conversation list

Implement `/messages` with the existing AppShell and ordinary authenticated Supabase reads. Return only participant conversation bindings, a bounded plain text latest-message preview, optional permitted counterpart name, and separately RLS-filtered flight route. Preserve closed conversation history without restoring private flight access. No mutation, new store, migration, realtime subscription or message composer.

Use creation timestamp plus UUID descending for stable 20-row keyset pages. Label the ordering explicitly. Validate cursors and provider results, bound each read, recheck participant rows after optional profile reads, and recheck current viewer before returning. Required read failures return a neutral retry state; optional profile absence does not erase history.

Add Messages navigation, loading, empty, invalid-page and retry states. Existing flight connection links provide working navigation until the message screen ticket. Verify authorization and cursor behavior with targeted unit tests; extend the existing real-session fixture for rendered list checks; inspect desktop/mobile using owned local data. Review and create the PR without applying hosted migrations or publishing production.
