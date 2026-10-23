import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Reuse the upgrade verifier's owned-local SQL/session/barrier infrastructure.
// No hosted destination, credentials or generic lifecycle runner is introduced.
export async function verifyRequestLocks({sql,session,until,submission=false}) {
 for (const kind of ['duplicate','request-first','removal-first','capacity',...(submission?['full-first']:[])]) {
  const owner=randomUUID(),requester=randomUUID(),other=randomUUID(),flight=randomUUID();
  const label='volo188_'+randomUUID().replaceAll('-','');
  const firstName=label+'_first',secondName=label+'_second';
  let first,second;
  const insert=id=>`insert into public.flight_requests(flight_id,requester_id) values('${flight}','${id}');`;
  const submit=(id,note='Concurrent hello')=>`set local role authenticated; select set_config('request.jwt.claims','{"sub":"${id}","role":"authenticated"}',true); select public.submit_flight_interest('${flight}','${note}');`;
  const remove=`set local role authenticated; select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true); select public.change_flight_recipient('${flight}','${requester}',false);`;
  const accept=id=>`select 1 from public.flights where id='${flight}' for update; update public.flight_requests set status='accepted' where flight_id='${flight}' and requester_id='${id}';`;
  try {
   sql(`insert into auth.users(id,email) values ('${owner}','${owner}@example.invalid'),('${requester}','${requester}@example.invalid'),('${other}','${other}@example.invalid');
    insert into public.memberships(user_id) values ('${owner}'),('${requester}'),('${other}');
    insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values ('${requester}','Owned requester','KPAO','licensed'),('${other}','Owned other','KPAO','licensed');
    insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values ('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',1,'PRIVATE');
    insert into public.flight_recipients(flight_id,user_id) values ('${flight}','${requester}'),('${flight}','${other}');`);
   if(kind==='capacity')sql(insert(requester)+insert(other));
   if(kind==='full-first')sql(insert(other));
   const firstQuery=kind==='capacity'?accept(requester):kind==='full-first'?accept(other):kind==='removal-first'?remove:submission?submit(requester,'First concurrent introduction'):insert(requester);
   const secondQuery=kind==='capacity'?accept(other):kind==='request-first'?remove:submission?submit(requester,'Second concurrent introduction'):insert(requester);
   first=session(firstName,`begin; ${firstQuery}\n\\echo winner_ready`,{hold:true});
   await until(()=>first.ready()||first.finished(),'Request race first transaction did not become ready');
   assert.ok(first.ready(),'Request race first transaction failed');
   second=session(secondName,`begin; ${secondQuery} commit;`);
   await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Request race did not overlap');
   assert.equal(second.finished(),false,'Competing request transaction must wait');
   first.child.stdin.end('commit;\n');
   const firstResult=await first.done;
   assert.equal(firstResult.code,0,'First request transaction failed to commit');
   const result=await second.done;
   if(kind==='request-first') {
    assert.equal(result.code,0,'Removal must cancel the committed request');
    assert.equal(sql(`select status from public.flight_requests where flight_id='${flight}';`),'cancelled');
   } else if(submission&&kind!=='capacity'){
    assert.equal(result.code,0,'RPC returns a safe semantic result after waiting');
    const response=JSON.parse(result.stdout.trim().split('\n').at(-1));
    assert.equal(response.code,kind==='duplicate'?'already_requested':'flight_unavailable');
    if(kind==='duplicate'){
     const winner=firstResult.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(value=>value?.code==='submitted');
     assert.ok(winner,'First caller receives a confirmed pending request');
     assert.deepEqual(response,{code:'already_requested',requestId:winner.requestId,status:'pending'},'Both callers confirm the same UUID without private data');
     const stored=JSON.parse(sql(`select json_build_object('id',id,'introductory_note',introductory_note,'created_at',created_at,'updated_at',updated_at) from public.flight_requests where flight_id='${flight}';`));
     assert.equal(stored.id,winner.requestId);assert.equal(stored.introductory_note,'First concurrent introduction');
     assert.equal(stored.created_at,stored.updated_at,'Duplicate result does not rewrite timestamps');
    }
   } else {
    assert.notEqual(result.code,0,'Competing invalid request mutation must fail');
    assert.match(result.stderr,kind==='duplicate'?/23505/:/23514/);
   }
   if(kind==='capacity')assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and status='accepted';`),'1');
   if(kind==='duplicate')assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}';`),'1');
   if(kind==='full-first')assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and requester_id='${requester}';`),'0');
   if(kind==='removal-first')assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}';`),'0');
   if(['request-first','removal-first'].includes(kind))assert.equal(sql(`select count(*) from public.flight_recipients where flight_id='${flight}' and user_id='${requester}';`),'0');
   console.log(`${submission?'Interest RPC':'Request'} ${kind}: observed competing lock and verified final state`);
  } finally {
   first?.child.stdin.end();second?.child.stdin.end();
   sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
   await Promise.all([first?.done,second?.done]);
   sql(`delete from public.flight_requests where flight_id='${flight}';delete from public.flight_recipients where flight_id='${flight}';delete from public.flights where id='${flight}';delete from public.profiles where user_id in ('${owner}','${requester}','${other}');delete from public.memberships where user_id in ('${owner}','${requester}','${other}');delete from auth.users where id in ('${owner}','${requester}','${other}');`);
  }
 }
}
