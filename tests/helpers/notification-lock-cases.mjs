import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Same owned PostgreSQL sessions/barriers as the existing upgrade verifier. */
export async function verifyNotificationLocks({sql,session,until}){
 const owner=randomUUID(),requester=randomUUID(),flight=randomUUID(),request=randomUUID(),label='volo219_'+randomUUID().replaceAll('-',''),firstName=label+'_first',secondName=label+'_retry';let first,second;
 const insert=`insert into public.notifications(event_type,request_id) values('request_received','${request}') on conflict(recipient_id,event_key) do nothing returning jsonb_build_object('id',id,'createdAt',created_at,'key',event_key);`;
 const receipts=result=>result.stdout.split('\n').flatMap(line=>{try{const value=JSON.parse(line);return value.id?[value]:[];}catch{return [];}});
 try{
  sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.invalid'),('${requester}','${requester}@example.invalid');insert into public.memberships(user_id,role) values('${owner}','member'),('${requester}','member');insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values('${requester}','Owned notification requester','KPAO','licensed');insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',1,'NETWORK');insert into public.flight_requests(id,flight_id,requester_id) values('${request}','${flight}','${requester}');`);
  first=session(firstName,`begin;${insert}\n\\echo winner_ready`,{hold:true});await until(()=>first.ready()||first.finished(),'First notification did not become ready');assert.ok(first.ready());
  second=session(secondName,`begin;${insert}select jsonb_build_object('id',id,'createdAt',created_at,'key',event_key) from public.notifications where request_id='${request}';commit;`);
  await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Competing notification never waited for original commit');assert.equal(second.finished(),false);
  first.child.stdin.end('commit;\n');const original=await first.done,retried=await second.done;assert.equal(original.code,0,original.stderr);assert.equal(retried.code,0,retried.stderr);assert.equal(receipts(original).length,1);assert.equal(receipts(retried).length,1);assert.deepEqual(receipts(retried)[0],receipts(original)[0]);assert.equal(sql(`select count(*) from public.notifications where request_id='${request}';`),'1');
  console.log('Notification concurrent retry: observed unique-key wait, one retained row and original ID/time/key');
  first=session(firstName,`begin;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);select public.mark_notification_read((select id from public.notifications where request_id='${request}'));\n\\echo winner_ready`,{hold:true});
  await until(()=>first.ready()||first.finished(),'First read marker did not become ready');assert.ok(first.ready());
  second=session(secondName,`begin;set local role authenticated;select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true);select public.mark_notification_read((select id from public.notifications where request_id='${request}'));commit;`);
  await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Read retry never waited for first mark');assert.equal(second.finished(),false);
  first.child.stdin.end('commit;\n');const marked=await first.done,repeated=await second.done;assert.equal(marked.code,0,marked.stderr);assert.equal(repeated.code,0,repeated.stderr);assert.equal(receipts(marked).length,1);assert.deepEqual(receipts(repeated),receipts(marked),'Concurrent marks preserve the first read timestamp');
  console.log('Notification concurrent mark: observed row-lock wait and preserved first read timestamp');

 }finally{
  first?.child.stdin.end();second?.child.stdin.end();sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);await Promise.all([first?.done,second?.done]);
  sql(`delete from public.notifications where request_id='${request}';delete from public.flight_requests where id='${request}';delete from public.flights where id='${flight}';delete from public.profiles where user_id='${requester}';delete from public.memberships where user_id in('${owner}','${requester}');delete from auth.users where id in('${owner}','${requester}');`);
 }
}
