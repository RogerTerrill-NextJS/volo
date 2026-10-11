-- VOLO-164: immutable, private photos with transactional ownership and cleanup.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('profile-photo-uploads','profile-photo-uploads',false,5000000,array['image/jpeg','image/png','image/webp']),
 ('profile-photos','profile-photos',false,5000000,array['image/webp']);
revoke insert(photo_storage_path), update(photo_storage_path) on public.profiles from authenticated;
alter table public.profiles add column photo_revision bigint not null default 0;
create table public.profile_photo_objects (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references public.profiles(user_id) on delete restrict,
 source_path text not null unique,
 final_path text not null unique,
 expected_path text,
 expected_revision bigint not null,
 state text not null default 'pending' check(state in ('pending','processing','ready','current','obsolete','cleaning')),
 expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
 processing_until timestamptz,
 source_deleted boolean not null default false,
 cleanup_token uuid,
 cleanup_until timestamptz,
 constraint photo_source_path check(source_path=owner_id::text||'/'||id::text||'/source'),
 constraint photo_final_path check(final_path=owner_id::text||'/'||id::text||'.webp')
);
create index profile_photo_objects_owner on public.profile_photo_objects(owner_id);
alter table public.profile_photo_objects enable row level security;
revoke all on public.profile_photo_objects from public,anon,authenticated,service_role;
grant select on public.profile_photo_objects to service_role;

-- Profile first, membership second, lifecycle third: shared by every transition.
create function public.lock_photo_owner(owner uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=owner for update;
 if not found then return false; end if;
 perform 1 from public.memberships where user_id=owner and status='active' for share;
 return found;
end $$;
revoke all on function public.lock_photo_owner(uuid) from public,anon,authenticated,service_role;

create function public.reserve_profile_photo() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid:=auth.uid(); candidate uuid:=gen_random_uuid(); p public.profiles; begin
 if not public.lock_photo_owner(owner) then return jsonb_build_object('code','forbidden'); end if;
 if exists(select 1 from public.profile_photo_objects where owner_id=owner and state in ('pending','processing','ready') and expires_at>clock_timestamp())
 or (select count(*) from public.profile_photo_objects where owner_id=owner and state<>'current')>=3 then return jsonb_build_object('code','limited'); end if;
 select * into p from public.profiles where user_id=owner;
 insert into public.profile_photo_objects(id,owner_id,source_path,final_path,expected_path,expected_revision)
 values(candidate,owner,owner::text||'/'||candidate::text||'/source',owner::text||'/'||candidate::text||'.webp',p.photo_storage_path,p.photo_revision);
 return jsonb_build_object('code','reserved','id',candidate,'source_path',owner::text||'/'||candidate::text||'/source');
end $$;
create function public.begin_profile_photo_finalize(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profile_photo_objects; begin
 if not public.lock_photo_owner(auth.uid()) then return jsonb_build_object('code','forbidden'); end if;
 select * into r from public.profile_photo_objects where id=reservation_id and owner_id=auth.uid() for update;
 if not found or r.state<>'pending' or r.expires_at<=clock_timestamp() then return jsonb_build_object('code','conflict'); end if;
 update public.profile_photo_objects set state='processing',processing_until=clock_timestamp()+interval '60 seconds' where id=r.id;
 return jsonb_build_object('code','processing','id',r.id,'source_path',r.source_path,'final_path',r.final_path);
end $$;
create function public.attach_profile_photo(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.profile_photo_objects; p public.profiles; begin
 if not public.lock_photo_owner(auth.uid()) then return jsonb_build_object('code','forbidden'); end if;
 select * into p from public.profiles where user_id=auth.uid();
 select * into r from public.profile_photo_objects where id=reservation_id and owner_id=auth.uid() for update;
 if found and r.state='current' and p.photo_storage_path=r.final_path then return jsonb_build_object('code','saved'); end if;
 if r.id is null or r.state<>'ready' or r.expires_at<=clock_timestamp() or r.processing_until<=clock_timestamp()
 or p.photo_revision<>r.expected_revision or p.photo_storage_path is distinct from r.expected_path then return jsonb_build_object('code','conflict'); end if;
 update public.profile_photo_objects set state='obsolete',cleanup_token=null,cleanup_until=null where owner_id=auth.uid() and state='current';
 update public.profiles set photo_storage_path=r.final_path,photo_revision=photo_revision+1 where user_id=auth.uid();
 update public.profile_photo_objects set state='current' where id=r.id;
 return jsonb_build_object('code','saved');
end $$;
create function public.remove_profile_photo() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.lock_photo_owner(auth.uid()) then return jsonb_build_object('code','forbidden'); end if;
 update public.profiles set photo_storage_path=null,photo_revision=photo_revision+1 where user_id=auth.uid();
 update public.profile_photo_objects set state='obsolete',cleanup_token=null,cleanup_until=null where owner_id=auth.uid() and state='current';
 return jsonb_build_object('code','removed');
end $$;
create function public.mark_profile_photo_ready(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; begin
 select owner_id into owner from public.profile_photo_objects where id=reservation_id;
 if not public.lock_photo_owner(owner) then return jsonb_build_object('code','conflict'); end if;
 update public.profile_photo_objects set state='ready' where id=reservation_id and state='processing' and expires_at>clock_timestamp() and processing_until>clock_timestamp();
 return jsonb_build_object('code',case when found then 'ready' else 'conflict' end);
end $$;
create function public.abandon_profile_photo(reservation_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; begin
 select owner_id into owner from public.profile_photo_objects where id=reservation_id;
 perform 1 from public.profiles where user_id=owner for update;
 -- Never abandon an attachment whose response may have been lost.
 update public.profile_photo_objects set state='obsolete' where id=reservation_id and state in ('pending','processing','ready')
 and not exists(select 1 from public.profiles where photo_storage_path=final_path);
 return jsonb_build_object('code',case when found then 'abandoned' else 'conflict' end);
end $$;
create function public.claim_profile_photo_cleanup(batch_size integer default 20)
 returns table(id uuid,source_path text,final_path text,claim_token uuid) language plpgsql security definer set search_path='' as $$
declare candidate record; r public.profile_photo_objects; p public.profiles; n integer:=0; token uuid; begin
 if batch_size is null or batch_size not between 1 and 20 then raise exception 'Invalid cleanup batch'; end if;
 for candidate in select o.id,o.owner_id from public.profile_photo_objects o
 where (o.cleanup_until is null or o.cleanup_until<clock_timestamp()) and
 (o.state in ('obsolete','cleaning') or (o.state='current' and not o.source_deleted) or
 (o.state in ('pending','processing','ready') and (o.expires_at<=clock_timestamp() or (o.processing_until is not null and o.processing_until<=clock_timestamp()))))
 order by o.owner_id,o.id loop
 select * into p from public.profiles where user_id=candidate.owner_id for update skip locked;
 if not found then continue; end if;
 select * into r from public.profile_photo_objects o where o.id=candidate.id for update skip locked;
 if not found or r.cleanup_until>clock_timestamp() then continue; end if;
 if r.state not in ('obsolete','cleaning','current') and r.expires_at>clock_timestamp() and (r.processing_until is null or r.processing_until>clock_timestamp()) then continue; end if;
 -- A reference always wins, even if lifecycle state was unexpectedly inconsistent.
 if p.photo_storage_path=r.final_path and r.source_deleted then continue; end if;
 token:=gen_random_uuid();
 update public.profile_photo_objects o set state=case when p.photo_storage_path=r.final_path then 'current' else 'cleaning' end,cleanup_token=token,cleanup_until=clock_timestamp()+interval '60 seconds' where o.id=r.id;
 id:=r.id; source_path:=case when r.source_deleted then null else r.source_path end;
 final_path:=case when p.photo_storage_path=r.final_path then null else r.final_path end;
 claim_token:=token; return next; n:=n+1; exit when n>=batch_size;
 end loop;
end $$;
create function public.ack_profile_photo_cleanup(reservation_id uuid,claim_token uuid,source_deleted boolean,final_deleted boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; r public.profile_photo_objects; p public.profiles; begin
 select owner_id into owner from public.profile_photo_objects where id=reservation_id;
 select * into p from public.profiles where user_id=owner for update;
 select * into r from public.profile_photo_objects where id=reservation_id for update;
 if r.id is null or r.cleanup_token is distinct from claim_token or r.cleanup_until<=clock_timestamp() then return jsonb_build_object('code','conflict'); end if;
 if p.photo_storage_path is distinct from r.final_path and r.state='cleaning' and (r.source_deleted or source_deleted) and final_deleted then
 delete from public.profile_photo_objects where id=r.id;
 else
 update public.profile_photo_objects set source_deleted=(r.source_deleted or ack_profile_photo_cleanup.source_deleted),cleanup_token=null,cleanup_until=null where id=r.id;
 end if;
 return jsonb_build_object('code','acknowledged');
end $$;

-- Storage v1.79.28 probes RLS before upload, then commits as superuser.
-- This trigger also runs at that privileged commit, closing the late-upload race.
create function public.check_profile_photo_storage_write() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.profile_photo_objects; owner uuid; begin
 if new.bucket_id not in ('profile-photo-uploads','profile-photos') then return new; end if;
 select owner_id into owner from public.profile_photo_objects where
 (new.bucket_id='profile-photo-uploads' and source_path=new.name) or (new.bucket_id='profile-photos' and final_path=new.name);
 if not public.lock_photo_owner(owner) then raise exception using errcode='42501',message='Photo reservation unavailable'; end if;
 select * into r from public.profile_photo_objects where owner_id=owner and
 ((new.bucket_id='profile-photo-uploads' and source_path=new.name) or (new.bucket_id='profile-photos' and final_path=new.name)) for update;
 if r.id is null or r.expires_at<=clock_timestamp() or
 (new.bucket_id='profile-photo-uploads' and (r.state<>'pending' or new.owner_id is distinct from owner::text)) or
 (new.bucket_id='profile-photos' and (r.state<>'processing' or r.processing_until<=clock_timestamp())) then
 raise exception using errcode='42501',message='Photo reservation unavailable'; end if;
 if tg_op='UPDATE' then raise exception using errcode='42501',message='Photos are immutable'; end if;
 return new;
end $$;
create trigger profile_photo_storage_write before insert or update on storage.objects for each row execute function public.check_profile_photo_storage_write();
revoke all on function public.check_profile_photo_storage_write() from public,anon,authenticated,service_role;
create policy profile_photo_source_insert on storage.objects for insert to authenticated with check
 (bucket_id='profile-photo-uploads' and owner_id=auth.uid()::text);
create policy profile_photo_current_read on storage.objects for select to authenticated using
 (bucket_id='profile-photos' and exists(select 1 from public.profiles where photo_storage_path=name)
 and exists(select 1 from public.memberships where user_id=auth.uid() and status='active'));

revoke all on function public.reserve_profile_photo(),public.begin_profile_photo_finalize(uuid),public.attach_profile_photo(uuid),public.remove_profile_photo() from public,anon,authenticated,service_role;
grant execute on function public.reserve_profile_photo(),public.begin_profile_photo_finalize(uuid),public.attach_profile_photo(uuid),public.remove_profile_photo() to authenticated;
revoke all on function public.mark_profile_photo_ready(uuid),public.abandon_profile_photo(uuid),public.claim_profile_photo_cleanup(integer),public.ack_profile_photo_cleanup(uuid,uuid,boolean,boolean) from public,anon,authenticated,service_role;
grant execute on function public.mark_profile_photo_ready(uuid),public.abandon_profile_photo(uuid),public.claim_profile_photo_cleanup(integer),public.ack_profile_photo_cleanup(uuid,uuid,boolean,boolean) to service_role;
comment on table public.profile_photo_objects is 'Private immutable photo reservations and retryable Storage cleanup; never client-editable.';
comment on column public.profiles.photo_storage_path is 'Private current profile-photos object, set only by owner-scoped photo RPCs.';
