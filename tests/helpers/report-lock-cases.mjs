import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Reuse the upgrade verifier's owned SQL sessions and observed lock barriers. */
export async function verifyReportRetryLocks({sql,session,until}){
 const owner=randomUUID(),reporter=randomUUID(),admin=randomUUID(),flight=randomUUID(),report=randomUUID();
 const label='volo217_'+randomUUID().replaceAll('-',''),firstName=label+'_report',hideName=label+'_hide',retryName=label+'_retry';
 const auth=(id,query)=>`set local role authenticated;select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true);${query}`;
 const submit=`select public.submit_report('${report}','flight','${flight}','Observed overlap');`;
 const values=result=>result.stdout.split('\n').flatMap(line=>{try{const value=JSON.parse(line);return value.code?[value]:[];}catch{return [];}});
 const blocked=(waiter,holder)=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${waiter}' and h.application_name='${holder}' and w.wait_event_type='Lock');`)==='t';
 let first,hide,retry;
 try{
  sql(`insert into auth.users(id,email) values('${owner}','${owner}@example.invalid'),('${reporter}','${reporter}@example.invalid'),('${admin}','${admin}@example.invalid');insert into public.memberships(user_id,role) values('${owner}','member'),('${reporter}','member'),('${admin}','admin');insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',1,'NETWORK');`);
  first=session(firstName,`begin;${auth(reporter,submit)}\n\\echo winner_ready`,{hold:true});
  await until(()=>first.ready()||first.finished(),'First report did not become ready');assert.ok(first.ready());
  hide=session(hideName,`begin;${auth(admin,`select public.admin_hide_flight('${flight}','Observed hide');`)}commit;`);
  await until(()=>blocked(hideName,firstName)||hide.finished(),'Hide never waited for report flight lock');assert.equal(hide.finished(),false);
  retry=session(retryName,`begin;${auth(reporter,submit)}commit;`);
  await until(()=>blocked(retryName,firstName)||blocked(retryName,hideName)||retry.finished(),'Retry never waited for the in-flight report or hide');assert.equal(retry.finished(),false);
  first.child.stdin.end('commit;\n');const original=await first.done,hidden=await hide.done,retried=await retry.done;
  assert.equal(original.code,0,original.stderr);assert.equal(hidden.code,0,hidden.stderr);assert.equal(retried.code,0,retried.stderr);
  assert.equal(values(original)[0].code,'reported');assert.equal(values(hidden)[0].code,'hidden');assert.equal(values(retried)[0].code,'already_reported','Exact retry must confirm receipt during overlapping hide');assert.equal(values(retried)[0].createdAt,values(original)[0].createdAt);
  assert.equal(sql(`select count(*) from public.reports where id='${report}';`),'1');assert.equal(sql(`select moderated_at is not null from public.flights where id='${flight}';`),'t');
  console.log('Report/hide/exact-retry: hide and retry waits observed; original receipt retained once');
 }finally{
  first?.child.stdin.end();hide?.child.stdin.end();retry?.child.stdin.end();sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${hideName}','${retryName}') and pid<>pg_backend_pid();`);await Promise.all([first?.done,hide?.done,retry?.done]);
  sql(`delete from public.reports where id='${report}';delete from public.flight_moderation_audit where flight_id='${flight}';delete from public.flights where id='${flight}';delete from public.memberships where user_id in('${owner}','${reporter}','${admin}');delete from auth.users where id in('${owner}','${reporter}','${admin}');`);
 }
}
