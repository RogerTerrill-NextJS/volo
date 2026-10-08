begin;

-- Match the ASCII whitespace boundary used for invitation email input. The
-- original btrim(text) stripped only spaces, accepting tab/newline-only reasons.
-- Validate existing history too; do not silently rewrite administrative reasons.
alter table public.invitations drop constraint invitations_revocation_state;
alter table public.invitations add constraint invitations_revocation_state check (
  (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null
    and revocation_reason is not null and char_length(revocation_reason) between 1 and 500
    and revocation_reason = btrim(revocation_reason, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)))
  or (status <> 'revoked' and revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
);

commit;
