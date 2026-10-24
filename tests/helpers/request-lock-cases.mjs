import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyFlightCancellationLocks({sql,session,until}){
 const cases=[
  ['accept-cancel','accept','cancel','decided','cancelled','cancelled'],
  ['cancel-accept','cancel','accept','cancelled','request_conflict','cancelled'],
  ['duplicate-cancel','cancel','cancel','cancelled','already_cancelled','cancelled'],
  ['withdraw-cancel','withdraw','cancel','withdrawn','cancelled','withdrawn'],
  ['cancel-withdraw','cancel','withdraw','cancelled','request_conflict','cancelled'],
  ['edit-cancel','edit','cancel','updated','cancelled','cancelled'],
  ['cancel-edit','cancel','edit','cancelled','flight_unavailable','cancelled'],
  ['submit-cancel','submit','cancel','submitted','cancelled','cancelled'],
  ['cancel-submit','cancel','submit','cancelled','flight_unavailable','withdrawn'],
 ];
 for(const [kind,firstOp,secondOp,firstCode,secondCode,finalStatus] of cases){
  const owner=randomUUID(),requester=randomUUID(),flight=randomUUID(),request=randomUUID();
  const label='volo199_'+randomUUID().replaceAll('-',''),firstName=label+'_first',secondName=label+'_second';
  const auth=(actor,query)=>`set local role authenticated;select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);${query}`;
  const values=result=>result.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  let first,second;
  try{
   sql(`insert into auth.users(id,email) values ('${owner}','${owner}@example.invalid'),('${requester}','${requester}@example.invalid');
    insert into public.memberships(user_id) values ('${owner}'),('${requester}');
    insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values ('${owner}','Cancel owner','KPAO','licensed'),('${requester}','Cancel requester','KPAO','licensed');
    insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values ('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',1,'PRIVATE');
    insert into public.flight_recipients(flight_id,user_id) values ('${flight}','${requester}');
    insert into public.flight_requests(id,flight_id,requester_id,introductory_note) values ('${request}','${flight}','${requester}','Preserved introduction');
    ${kind.includes('submit')?`update public.flight_requests set status='withdrawn' where id='${request}';`:''}`);
   const original=JSON.parse(sql(`select to_jsonb(f) from public.flights f where id='${flight}';`));
   const originalRequest=JSON.parse(sql(`select to_jsonb(r) from public.flight_requests r where id='${request}';`));
   const operations={cancel:auth(owner,`select public.cancel_flight('${flight}');`),accept:auth(owner,`select public.decide_flight_request('${flight}','${request}','accepted');`),withdraw:auth(requester,`select public.withdraw_flight_request('${flight}','${request}');`),submit:auth(requester,`select public.submit_flight_interest('${flight}','Preserved introduction');`),edit:auth(owner,`select public.edit_flight('${flight}','${original.updated_at}','KPAO','KSQL','${original.departure_at}','UTC','C172',1,'Edited note');`)};
   first=session(firstName,`begin;${operations[firstOp]}
    select json_build_object('snapshot',to_jsonb(f)) from public.flights f where id='${flight}';
    select json_build_object('requestSnapshot',to_jsonb(r)) from public.flight_requests r where id='${request}';
    \\echo winner_ready`,{hold:true});
   await until(()=>first.ready()||first.finished(),'Cancellation first operation did not become ready');
   assert.ok(first.ready(),'First cancellation race operation failed');
   second=session(secondName,`begin;${operations[secondOp]} commit;`);
   await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Cancellation operations did not overlap');
   assert.equal(second.finished(),false,'Second operation waits on common flight lock');
   first.child.stdin.end('commit;\n');const winner=await first.done,loser=await second.done;
   assert.equal(winner.code,0);assert.equal(loser.code,0);
   assert.equal(values(winner).find(v=>v?.code)?.code,firstCode);assert.equal(values(loser).find(v=>v?.code)?.code,secondCode);
   const stored=JSON.parse(sql(`select to_jsonb(f) from public.flights f where id='${flight}';`));
   const storedRequest=JSON.parse(sql(`select to_jsonb(r) from public.flight_requests r where id='${request}';`));
   assert.equal(stored.status,'cancelled');assert.equal(storedRequest.status,finalStatus);
   assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and status in ('pending','accepted');`),'0');
   for(const key of ['id','owner_id','created_at','visibility','departure_at','pilot_places'])assert.equal(stored[key],original[key]);
   for(const key of ['id','flight_id','requester_id','created_at','introductory_note'])assert.equal(storedRequest[key],originalRequest[key]);
   assert.equal(sql(`select count(*) from public.flight_recipients where flight_id='${flight}';`),'1');
   assert.equal(stored.notes,kind==='edit-cancel'?'Edited note':null);
   if(firstOp==='cancel'){
    assert.deepEqual(stored,values(winner).find(v=>v?.snapshot)?.snapshot,'Retry/conflict cannot rewrite cancelled flight');
    assert.deepEqual(storedRequest,values(winner).find(v=>v?.requestSnapshot)?.requestSnapshot,'Retry/conflict cannot rewrite closed request');
   }
   console.log(`Flight cancellation ${kind}: observed competing lock and verified closed state/history`);
  }finally{
   first?.child.stdin.end();second?.child.stdin.end();
   sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
   await Promise.all([first?.done,second?.done]);
   sql(`delete from public.flight_requests where flight_id='${flight}';delete from public.flight_recipients where flight_id='${flight}';delete from public.flights where id='${flight}';delete from public.profiles where user_id in ('${owner}','${requester}');delete from public.memberships where user_id in ('${owner}','${requester}');delete from auth.users where id in ('${owner}','${requester}');`);
  }
 }
}

export async function verifyFlightEditLocks({sql,session,until}){
 const cases=[
  ['accept-material',0,'accept','material','decided','repost_required',2,1,'KPAO'],
  ['material-accept',0,'material','accept','updated','decided',2,1,'KSFO'],
  ['accept-capacity',1,'other-accept','capacity','decided','capacity_conflict',2,2,'KPAO'],
  ['capacity-accept',1,'capacity','other-accept','updated','capacity_full',1,1,'KPAO'],
  ['withdraw-capacity',2,'withdraw','capacity','withdrawn','updated',1,1,'KPAO'],
  ['capacity-withdraw',2,'capacity','withdraw','capacity_conflict','withdrawn',2,1,'KPAO'],
  ['different-edits',0,'note','other-note','updated','flight_conflict',2,0,'KPAO'],
  ['identical-edits',0,'note','note','updated','already_updated',2,0,'KPAO'],
 ];
 for(const [kind,accepted,firstOp,secondOp,firstCode,secondCode,places,count,airport] of cases){
  const owner=randomUUID(),requester=randomUUID(),other=randomUUID(),flight=randomUUID(),request=randomUUID(),competing=randomUUID();
  const label='volo197_'+randomUUID().replaceAll('-',''),firstName=label+'_first',secondName=label+'_second';
  const auth=(actor,query)=>`set local role authenticated;select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);${query}`;
  const values=result=>result.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  let first,second;
  try{
   sql(`insert into auth.users(id,email) values ('${owner}','${owner}@example.invalid'),('${requester}','${requester}@example.invalid'),('${other}','${other}@example.invalid');
    insert into public.memberships(user_id) values ('${owner}'),('${requester}'),('${other}');
    insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values ('${owner}','Edit owner','KPAO','licensed'),('${requester}','Edit requester','KPAO','licensed'),('${other}','Edit other','KPAO','licensed');
    insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values ('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',2,'PRIVATE');
    insert into public.flight_recipients(flight_id,user_id) values ('${flight}','${requester}'),('${flight}','${other}');
    insert into public.flight_requests(id,flight_id,requester_id,introductory_note) values ('${request}','${flight}','${requester}','First introduction'),('${competing}','${flight}','${other}','Other introduction');
    ${accepted?`update public.flight_requests set status='accepted' where ${accepted===2?`flight_id='${flight}'`:`id='${request}'`};`:''}`);
   const original=JSON.parse(sql(`select to_jsonb(f) from public.flights f where id='${flight}';`));
   const edit=(start='KPAO',capacity=2,note=null)=>auth(owner,`select public.edit_flight('${flight}','${original.updated_at}','${start}','KSQL','${original.departure_at}','UTC','C172',${capacity},${note?`'${note}'`:'null'});`);
   const operations={material:edit('KSFO'),capacity:edit('KPAO',1),note:edit('KPAO',2,'First edit'),'other-note':edit('KPAO',2,'Second edit'),accept:auth(owner,`select public.decide_flight_request('${flight}','${request}','accepted');`),'other-accept':auth(owner,`select public.decide_flight_request('${flight}','${competing}','accepted');`),withdraw:auth(requester,`select public.withdraw_flight_request('${flight}','${request}');`)};
   first=session(firstName,`begin;${operations[firstOp]} select json_build_object('snapshot',to_jsonb(f)) from public.flights f where id='${flight}';\n\\echo winner_ready`,{hold:true});
   await until(()=>first.ready()||first.finished(),'First edit race operation did not become ready');assert.ok(first.ready(),'First edit race operation failed');
   second=session(secondName,`begin;${operations[secondOp]} commit;`);
   await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Edit operations did not overlap');
   assert.equal(second.finished(),false,'Second edit lifecycle operation waits on common flight lock');
   first.child.stdin.end('commit;\n');const winner=await first.done,loser=await second.done;
   assert.equal(winner.code,0);assert.equal(loser.code,0);assert.equal(values(winner).find(v=>v?.code)?.code,firstCode);assert.equal(values(loser).find(v=>v?.code)?.code,secondCode);
   const stored=JSON.parse(sql(`select to_jsonb(f) from public.flights f where id='${flight}';`));
   assert.equal(stored.pilot_places,places);assert.equal(stored.departure_airport,airport);assert.equal(Number(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and status='accepted';`)),count);
   for(const key of ['id','owner_id','created_at','visibility','status'])assert.equal(stored[key],original[key]);
   assert.equal(sql(`select count(*) from public.flight_recipients where flight_id='${flight}';`),'2');
   assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and introductory_note in ('First introduction','Other introduction');`),'2');
   if(['different-edits','identical-edits','accept-material','accept-capacity','capacity-accept'].includes(kind))assert.deepEqual(stored,values(winner).find(v=>v?.snapshot)?.snapshot,'Later conflict/no-op/decision cannot rewrite winner flight');
   if(kind==='different-edits'||kind==='identical-edits')assert.equal(stored.notes,'First edit');
   console.log(`Flight edit ${kind}: observed competing lock and verified capacity/material/revision invariant`);
  }finally{
   first?.child.stdin.end();second?.child.stdin.end();sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
   await Promise.all([first?.done,second?.done]);
   sql(`delete from public.flight_requests where flight_id='${flight}';delete from public.flight_recipients where flight_id='${flight}';delete from public.flights where id='${flight}';delete from public.profiles where user_id in ('${owner}','${requester}','${other}');delete from public.memberships where user_id in ('${owner}','${requester}','${other}');delete from auth.users where id in ('${owner}','${requester}','${other}');`);
  }
 }
}

// Withdrawal shares the established flight lock with decisions, resubmission and
// PRIVATE removal. Observe real blocking before committing the first operation.
export async function verifyRequestWithdrawalLocks({sql,session,until}){
 const cases=[
  ['duplicate','pending','withdraw','withdraw','withdrawn','already_withdrawn','withdrawn','pending'],
  ['accept-withdraw','pending','accept','withdraw','decided','withdrawn','withdrawn','pending'],
  ['withdraw-accept','pending','withdraw','accept','withdrawn','request_conflict','withdrawn','pending'],
  ['withdraw-other-accept','accepted','withdraw','other-accept','withdrawn','decided','withdrawn','accepted'],
  ['other-accept-withdraw','accepted','other-accept','withdraw','capacity_full','withdrawn','withdrawn','pending'],
  ['withdraw-resubmit','pending','withdraw','submit','withdrawn','submitted','pending','pending'],
  ['resubmit-withdraw','withdrawn','submit','withdraw','submitted','withdrawn','withdrawn','pending'],
  ['removal-withdraw','accepted','remove','withdraw',null,'request_conflict','cancelled','pending'],
  ['withdraw-removal','accepted','withdraw','remove','withdrawn',null,'withdrawn','pending'],
 ];
 for(const [kind,initial,firstOp,secondOp,firstCode,secondCode,finalStatus,otherStatus] of cases){
  const owner=randomUUID(),requester=randomUUID(),other=randomUUID(),flight=randomUUID(),request=randomUUID(),competing=randomUUID();
  const label='volo195_'+randomUUID().replaceAll('-',''),firstName=label+'_first',secondName=label+'_second';
  const auth=(actor,query)=>`set local role authenticated; select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true); ${query}`;
  const operations={withdraw:auth(requester,`select public.withdraw_flight_request('${flight}','${request}');`),accept:auth(owner,`select public.decide_flight_request('${flight}','${request}','accepted');`),'other-accept':auth(owner,`select public.decide_flight_request('${flight}','${competing}','accepted');`),submit:auth(requester,`select public.submit_flight_interest('${flight}','Fresh resubmission');`),remove:auth(owner,`select public.change_flight_recipient('${flight}','${requester}',false);`)};
  const values=result=>result.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
  let first,second;
  try{
   sql(`insert into auth.users(id,email) values ('${owner}','${owner}@example.invalid'),('${requester}','${requester}@example.invalid'),('${other}','${other}@example.invalid');
    insert into public.memberships(user_id) values ('${owner}'),('${requester}'),('${other}');
    insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values ('${requester}','Withdrawal requester','KPAO','licensed'),('${other}','Withdrawal other','KPAO','licensed');
    insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values ('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',1,'PRIVATE');
    insert into public.flight_recipients(flight_id,user_id) values ('${flight}','${requester}'),('${flight}','${other}');
    insert into public.flight_requests(id,flight_id,requester_id,introductory_note) values ('${request}','${flight}','${requester}','Original introduction'),('${competing}','${flight}','${other}','Other introduction');
    ${initial==='pending'?'':`update public.flight_requests set status='${initial}' where id='${request}';`}`);
   const original=JSON.parse(sql(`select to_jsonb(r) from public.flight_requests r where id='${request}';`));
   first=session(firstName,`begin; ${operations[firstOp]} select json_build_object('snapshot',to_jsonb(r)) from public.flight_requests r where id='${request}';\n\\echo winner_ready`,{hold:true});
   await until(()=>first.ready()||first.finished(),'Withdrawal first operation did not become ready');assert.ok(first.ready(),'First withdrawal operation failed');
   second=session(secondName,`begin; ${operations[secondOp]} commit;`);
   await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Withdrawal operations did not overlap');
   assert.equal(second.finished(),false,'Second lifecycle operation must wait');
   first.child.stdin.end('commit;\n');const winner=await first.done,loser=await second.done;
   assert.equal(winner.code,0,'First lifecycle operation commits');assert.equal(loser.code,0,'Waiting operation returns safe result');
   if(firstCode)assert.equal(values(winner).find(v=>v?.code)?.code,firstCode);
   if(secondCode)assert.equal(values(loser).find(v=>v?.code)?.code,secondCode);
   const stored=JSON.parse(sql(`select to_jsonb(r) from public.flight_requests r where id='${request}';`));
   assert.equal(stored.status,finalStatus);for(const key of ['id','flight_id','requester_id','created_at'])assert.equal(stored[key],original[key]);
   assert.equal(stored.introductory_note,[firstOp,secondOp].includes('submit')?'Fresh resubmission':original.introductory_note);
   assert.equal(sql(`select status from public.flight_requests where id='${competing}';`),otherStatus);
   assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}';`),'2');
   assert.ok(Number(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and status='accepted';`))<=1,'Capacity invariant preserved');
   if(['duplicate','withdraw-accept','removal-withdraw','withdraw-removal'].includes(kind))assert.deepEqual(stored,values(winner).find(v=>v?.snapshot)?.snapshot,'No-op/conflicting operation preserves complete winner record');
   if(kind.includes('removal'))assert.equal(sql(`select count(*) from public.flight_recipients where flight_id='${flight}' and user_id='${requester}';`),'0');
   console.log(`Withdrawal ${kind}: observed competing lock and verified final state`);
  }finally{
   first?.child.stdin.end();second?.child.stdin.end();
   sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
   await Promise.all([first?.done,second?.done]);
   sql(`delete from public.flight_requests where flight_id='${flight}';delete from public.flight_recipients where flight_id='${flight}';delete from public.flights where id='${flight}';delete from public.profiles where user_id in ('${owner}','${requester}','${other}');delete from public.memberships where user_id in ('${owner}','${requester}','${other}');delete from auth.users where id in ('${owner}','${requester}','${other}');`);
  }
 }
}

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

// Exercise the authenticated decision RPC, not privileged trigger-only updates.
export async function verifyRequestDecisionLocks({sql,session,until}) {
 for(const kind of ['last-place','same-decision','accept-decline','decline-accept','accept-removal','removal-accept']){
  const owner=randomUUID(),requester=randomUUID(),other=randomUUID(),flight=randomUUID(),request=randomUUID(),competing=randomUUID();
  const label='volo193_'+randomUUID().replaceAll('-',''),firstName=label+'_first',secondName=label+'_second';
  const authenticated=query=>`set local role authenticated; select set_config('request.jwt.claims','{"sub":"${owner}","role":"authenticated"}',true); ${query}`;
  const decide=(id,decision='accepted')=>authenticated(`select public.decide_flight_request('${flight}','${id}','${decision}');`);
  const remove=authenticated(`select public.change_flight_recipient('${flight}','${requester}',false);`);
  const jsonResult=result=>result.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(value=>value?.code);
  let first,second;
  try{
   sql(`insert into auth.users(id,email) values ('${owner}','${owner}@example.invalid'),('${requester}','${requester}@example.invalid'),('${other}','${other}@example.invalid');
    insert into public.memberships(user_id) values ('${owner}'),('${requester}'),('${other}');
    insert into public.profiles(user_id,display_name,home_airport,pilot_designation) values ('${requester}','Decision requester','KPAO','licensed'),('${other}','Decision other','KPAO','licensed');
    insert into public.flights(id,owner_id,departure_airport,destination_airport,departure_at,departure_timezone,aircraft_description,pilot_places,visibility) values ('${flight}','${owner}','KPAO','KSQL',now()+interval '2 days','UTC','C172',1,'PRIVATE');
    insert into public.flight_recipients(flight_id,user_id) values ('${flight}','${requester}'),('${flight}','${other}');
    insert into public.flight_requests(id,flight_id,requester_id,introductory_note) values ('${request}','${flight}','${requester}','Original first note'),('${competing}','${flight}','${other}','Original other note');`);
   const original=JSON.parse(sql(`select to_jsonb(r) from public.flight_requests r where id='${request}';`));
   const firstQuery=kind==='removal-accept'?remove:decide(request,kind==='decline-accept'?'declined':'accepted');
   const secondQuery=kind==='accept-removal'?remove:decide(kind==='last-place'?competing:request,kind==='accept-decline'?'declined':'accepted');
   first=session(firstName,`begin; ${firstQuery}
    select json_build_object('snapshot',to_jsonb(r)) from public.flight_requests r where id='${request}';
    \\echo winner_ready`,{hold:true});
   await until(()=>first.ready()||first.finished(),'Decision first transaction did not become ready');
   assert.ok(first.ready(),'First decision transaction failed');
   second=session(secondName,`begin; ${secondQuery} commit;`);
   await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Decision operations did not overlap');
   assert.equal(second.finished(),false,'Second decision must wait on the first transaction');
   first.child.stdin.end('commit;\n');
   const winner=await first.done,loser=await second.done;
   assert.equal(winner.code,0,'First decision transaction commits');assert.equal(loser.code,0,'Waiting operation returns a safe result');
   const stored=JSON.parse(sql(`select to_jsonb(r) from public.flight_requests r where id='${request}';`));
   assert.equal(stored.id,original.id);assert.equal(stored.created_at,original.created_at);assert.equal(stored.introductory_note,original.introductory_note);
   if(kind!=='removal-accept')assert.deepEqual(jsonResult(winner),{code:'decided',requestId:request,status:kind==='decline-accept'?'declined':'accepted'});
   if(kind==='last-place'){
    assert.deepEqual(jsonResult(loser),{code:'capacity_full'});
    assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and status='accepted';`),'1');
    assert.equal(sql(`select status from public.flight_requests where id='${competing}';`),'pending');
   }else if(kind==='accept-removal'||kind==='removal-accept'){
    assert.equal(stored.status,'cancelled');
    assert.equal(sql(`select count(*) from public.flight_recipients where flight_id='${flight}' and user_id='${requester}';`),'0');
    assert.equal(sql(`select count(*) from public.flight_requests where flight_id='${flight}' and status='accepted';`),'0');
    if(kind==='removal-accept')assert.deepEqual(jsonResult(loser),{code:'request_conflict'});
   }else{
    assert.deepEqual(jsonResult(loser),kind==='same-decision'?{code:'already_decided',requestId:request,status:'accepted'}:{code:'request_conflict'});
    const snapshot=winner.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).find(value=>value?.snapshot)?.snapshot;
    assert.deepEqual(stored,snapshot,'Waiting retry/conflict preserves the entire first-decided record');
   }
   console.log(`Decision RPC ${kind}: observed competing lock and verified safe result/final state`);
  }finally{
   first?.child.stdin.end();second?.child.stdin.end();
   sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
   await Promise.all([first?.done,second?.done]);
   sql(`delete from public.flight_requests where flight_id='${flight}';delete from public.flight_recipients where flight_id='${flight}';delete from public.flights where id='${flight}';delete from public.profiles where user_id in ('${owner}','${requester}','${other}');delete from public.memberships where user_id in ('${owner}','${requester}','${other}');delete from auth.users where id in ('${owner}','${requester}','${other}');`);
  }
 }
}
