begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(2);
-- Missing persistence is the initial RED; no migration is present yet.
select has_table('public', 'invitations', 'Invitation persistence exists');
select has_table('public', 'invitation_send_attempts', 'Durable send reservations exist');
select * from finish();
rollback;
