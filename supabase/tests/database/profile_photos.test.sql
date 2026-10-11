begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();
select has_table('public','profile_photo_objects','Photo lifecycle persists');
select is((select count(*)::integer from storage.buckets where id in ('profile-photos','profile-photo-uploads') and not public and file_size_limit=5000000),2,'Both private buckets enforce the byte limit');
insert into auth.users(id,email) values
 ('44444444-4444-4444-8444-444444444444','photo-owner@example.invalid'),
 ('55555555-5555-4555-8555-555555555555','photo-admin@example.invalid');
insert into public.memberships(user_id,role,status) values
 ('44444444-4444-4444-8444-444444444444','member','active'),
 ('55555555-5555-4555-8555-555555555555','admin','active');
insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values
 ('44444444-4444-4444-8444-444444444444','Owner','KPAO','student'),
 ('55555555-5555-4555-8555-555555555555','Admin','KPAO','licensed');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select throws_ok('select * from public.profile_photo_objects','42501',null,'Lifecycle history is private');
select throws_ok($$update public.profiles set photo_storage_path='spoof' where user_id=auth.uid()$$,'42501',null,'Direct photo pointer writes denied');
select throws_ok($$insert into public.profiles(display_name,home_airport,pilot_designation,photo_storage_path) values('Spoof','KPAO','student','spoof')$$,'42501',null,'Direct photo pointer insertion denied');
select set_config('photo.test.id',(public.reserve_profile_photo()->>'id'),true);
select is(public.reserve_profile_photo()->>'code','limited','Only one live candidate');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id) values('profile-photo-uploads','44444444-4444-4444-8444-444444444444/'||current_setting('photo.test.id')||'/source',auth.uid()::text)$$,'Owner uploads reserved source');
select is((select count(*)::integer from storage.objects where bucket_id='profile-photo-uploads'),0,'Even owner cannot read raw source');
select is(public.begin_profile_photo_finalize(current_setting('photo.test.id')::uuid)->>'code','processing','Owner claims finalization');
select is(public.attach_profile_photo(current_setting('photo.test.id')::uuid)->>'code','conflict','Unprocessed object cannot attach');
select throws_ok('select public.count_profile_photo_cleanup()','42501',null,'Cleanup status stays server-only');
select throws_ok('select public.mark_profile_photo_ready(current_setting(''photo.test.id'')::uuid)','42501',null,'Client cannot mark validated image ready');
select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
select is(public.begin_profile_photo_finalize(current_setting('photo.test.id')::uuid)->>'code','conflict','Admin cannot finalize owner candidate');
select is(public.attach_profile_photo(current_setting('photo.test.id')::uuid)->>'code','conflict','Admin cannot attach owner candidate');
reset role;
insert into storage.objects(bucket_id,name) values('profile-photos','44444444-4444-4444-8444-444444444444/'||current_setting('photo.test.id')||'.webp');
select is(public.mark_profile_photo_ready(current_setting('photo.test.id')::uuid)->>'code','ready','Server marks processed candidate');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select is(public.attach_profile_photo(current_setting('photo.test.id')::uuid)->>'code','saved','Owner attaches ready candidate');
select is((select photo_storage_path from public.profiles where user_id=auth.uid()),'44444444-4444-4444-8444-444444444444/'||current_setting('photo.test.id')||'.webp','Pointer derives from authenticated owner');
select is(public.attach_profile_photo(current_setting('photo.test.id')::uuid)->>'code','saved','Lost response can be reconciled idempotently');
select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
select is((select count(*)::integer from storage.objects where bucket_id='profile-photos'),1,'Another active pilot reads only current final photo');
select throws_ok($$delete from storage.objects where bucket_id='profile-photos'$$,null,null,'Direct Storage deletion is prohibited');
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select set_config('photo.test.second',(public.reserve_profile_photo()->>'id'),true);
select is(public.remove_profile_photo()->>'code','removed','Owner removes current pointer');
select is(public.remove_profile_photo()->>'code','removed','Removal is idempotent');
select is(public.begin_profile_photo_finalize(current_setting('photo.test.second')::uuid)->>'code','processing','Second candidate claimed');
reset role;
select public.mark_profile_photo_ready(current_setting('photo.test.second')::uuid);
set local role authenticated;
select is(public.attach_profile_photo(current_setting('photo.test.second')::uuid)->>'code','conflict','Stale candidate cannot undo removal');
reset role;
update public.profile_photo_objects set expires_at=now()-interval '1 minute' where id=current_setting('photo.test.second')::uuid;
select is(public.count_profile_photo_cleanup('44444444-4444-4444-8444-444444444444'),2,'Pending count includes owner cleanup work');
select lives_ok('select * from public.claim_profile_photo_cleanup(20)','Cleanup claims expired and obsolete candidates');
select is(public.count_profile_photo_cleanup('44444444-4444-4444-8444-444444444444'),2,'Leased cleanup remains pending');
select is(public.count_profile_photo_cleanup('55555555-5555-4555-8555-555555555555'),0,'Pending count is owner scoped');
select is(public.mark_profile_photo_ready(current_setting('photo.test.second')::uuid)->>'code','conflict','Cleanup claim cannot be revived');
select throws_ok($$insert into storage.objects(bucket_id,name) values('profile-photo-uploads','44444444-4444-4444-8444-444444444444/'||current_setting('photo.test.second')||'/source')$$,'42501',null,'Late privileged Storage commit rechecks lifecycle');
select set_config('photo.test.third',(public.reserve_profile_photo()->>'id'),true);
update public.profile_photo_objects set expires_at=clock_timestamp()-interval '1 second' where id=current_setting('photo.test.third')::uuid;
select is(public.reserve_profile_photo()->>'code','limited','Expired cleanup work still counts toward outstanding cap');
set local role anon;
select throws_ok('select public.reserve_profile_photo()','42501',null,'Anonymous reservation denied');
reset role;
select * from finish();
rollback;
