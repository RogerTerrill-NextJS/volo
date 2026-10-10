import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

// Deliberately not a general database administration command.
if (process.argv.length !== 2) throw new Error('Invitation upgrade verifier accepts no arguments');
if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
    || process.env.GITHUB_REPOSITORY !== 'RogerTerrill-NextJS/volo') {
  throw new Error('Invitation upgrade verifier requires a GitHub-hosted disposable runner');
}
const root=fileURLToPath(new URL('../',import.meta.url));
assert.match(readFileSync(new URL('../supabase/config.toml',import.meta.url),'utf8'),/^project_id = "volo"$/m);
const cli=fileURLToPath(new URL('../node_modules/supabase/dist/supabase.js',import.meta.url));
const container='supabase_db_volo';
// Do not forward provider/database credentials or remote Docker selection.
const env={CI:'true',GITHUB_ACTIONS:'true'};
for (const key of ['PATH','HOME','TMPDIR']) if (process.env[key]) env[key]=process.env[key];
function run(command,args,{input,quiet=false}={}) {
  const result=spawnSync(command,args,{cwd:root,env,input,encoding:'utf8',maxBuffer:10*1024*1024,timeout:180000});
  if (result.error) throw result.error;
  if (result.status !== 0) {
    // Commands target only fictional local data; never print snapshot content.
    if (!quiet) process.stderr.write(result.stderr || 'Disposable database command failed\n');
    throw new Error(`Disposable database command exited ${result.status}`);
  }
  if (!quiet) process.stdout.write(result.stdout);
  return result.stdout.trim();
}
function sql(query) {
  return run('docker',['exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At'],{input:query,quiet:true});
}
function ownership() {
  assert.equal(run('docker',['inspect','--format','{{ index .Config.Labels "com.supabase.cli.project" }}',container],{quiet:true}),'volo','Unexpected database owner');
  assert.equal(sql('show server_version_num;').slice(0,2),'17','PostgreSQL 17 required');
  const versions=JSON.parse(sql('select coalesce(json_agg(version order by version),\'[]\'::json) from supabase_migrations.schema_migrations;'));
  assert.ok(versions.length>0 && versions.every(v=>['20261006040000','20261008010000','20261008020000','20261009010000','20261009020000','20261009030000','20261009040000','20261010010000'].includes(v)),'Unexpected migration history');
}
ownership();
run(process.execPath,[cli,'db','reset','--local','--version','20261006040000','--yes']);
// Confirm the owned prior schema before applying the new migration.
ownership();
assert.equal(sql("select to_regclass('public.invitations') is null and to_regclass('public.invitation_send_attempts') is null;"),'t');
assert.equal(sql('select count(*) from public.memberships;'),'3');
assert.equal(sql('select count(*) from auth.users;'),'3');
const snapshotQuery=`select json_build_object(
 'memberships',(select json_agg(m order by user_id) from public.memberships m),
 'auth',(select json_agg(u order by id) from (select id,email,aud,role,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at from auth.users) u));`;
const before=sql(snapshotQuery);
const baseline=JSON.parse(sql("select json_agg(version order by version) from supabase_migrations.schema_migrations;"));
assert.deepEqual(baseline,['20261006040000']);
console.log('Owned PostgreSQL 17 prior schema and three fictional fixtures confirmed');
run(process.execPath,[cli,'db','push','--local','--skip-vault','--yes']);
assert.equal(sql(snapshotQuery),before,'Upgrade changed existing memberships or Auth fixture fields');
assert.equal(sql("select to_regclass('public.invitations') is not null and to_regclass('public.invitation_send_attempts') is not null;"),'t');
assert.deepEqual(JSON.parse(sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;')),['20261006040000','20261008010000','20261008020000','20261009010000','20261009020000','20261009030000','20261009040000','20261010010000']);
run(process.execPath,[cli,'test','db','--local']);
console.log('Prior-schema upgrade, fixture preservation and database regressions passed');

// Real overlapping transactions reuse this owned database; no destination or
// credential options are exposed. PostgreSQL timeouts also bound orphaned execs.
function session(name,query,{hold=false}={}) {
  const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt',
    '-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],
    {cwd:root,env,stdio:['pipe','pipe','pipe'],timeout:60000,killSignal:'SIGKILL'});
  let stdout='',stderr='';
  let finished=false;
  child.stdout.on('data',chunk=>{stdout+=chunk;});
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  // Cleanup may close stdin while PostgreSQL is exiting after a failed assertion.
  child.stdin.on('error',()=>{});
  const done=new Promise(resolve=>{
    child.on('error',error=>{finished=true;resolve({code:null,error});});
    child.on('close',code=>{finished=true;resolve({code,stdout,stderr});});
  });
  child.stdin.write(`set application_name='${name}';
    set statement_timeout='30s'; set idle_in_transaction_session_timeout='30s';
    set transaction_timeout='45s'; ${query}\n`);
  if (!hold) child.stdin.end();
  return {child,done,finished:()=>finished,ready:()=>stdout.includes('winner_ready')};
}
async function until(predicate,message) {
  const deadline=Date.now()+20000;
  while (Date.now()<deadline) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(message);
}
async function concurrentCreation(kind) {
  const winnerId=randomUUID(),loserId=randomUUID(),subject=randomUUID();
  const winnerName=`volo130_${kind}_winner`,loserName=`volo130_${kind}_loser`;
  const email=`${winnerId}@example.invalid`;
  const secondEmail=kind==='email' ? email.toUpperCase() : `${loserId}@example.invalid`;
  const subjectColumns=kind==='subject' ? ',status,auth_user_id' : '';
  const subjectValues=kind==='subject' ? `,'issued','${subject}'` : '';
  const insert=(id,address)=>`insert into public.invitations
    (id,recipient_email,invited_by_user_id${subjectColumns}) values
    ('${id}','${address}','11111111-1111-4111-8111-111111111111'${subjectValues});`;
  let winner,loser;
  try {
    if (kind==='subject') sql(`insert into auth.users(id,email) values ('${subject}','${subject}@example.invalid');`);
    winner=session(winnerName,`begin; ${insert(winnerId,email)}\n\\echo winner_ready`,{hold:true});
    await until(()=>winner.ready() || winner.finished(),'First insert did not become ready');
    assert.ok(winner.ready(),'First insert failed before the race');
    loser=session(loserName,insert(loserId,secondEmail));
    await until(()=>sql(`select exists(select 1 from pg_stat_activity waiter
      join pg_stat_activity holder on holder.pid=any(pg_blocking_pids(waiter.pid))
      where waiter.application_name='${loserName}' and holder.application_name='${winnerName}'
      and waiter.wait_event_type='Lock');`)==='t' || loser.finished(),
      'Competing insert never blocked on the uncommitted invitation');
    assert.equal(loser.finished(),false,'Competing insert completed without waiting');
    winner.child.stdin.end('commit;\n');
    assert.equal((await winner.done).code,0,'First insert did not commit');
    const rejected=await loser.done;
    assert.notEqual(rejected.code,0,'Conflicting concurrent invitation was accepted');
    assert.match(rejected.stderr,/23505/,'Expected unique violation, not another failure');
    assert.ok(rejected.stderr.includes(kind==='email' ? 'invitations_live_email_key' : 'invitations_live_auth_subject'),
      'Wrong uniqueness constraint rejected the insert');
    assert.equal(sql(`select count(*) from public.invitations where id in ('${winnerId}','${loserId}');`),'1');
    assert.equal(sql(`select count(*) from public.invitations where id='${winnerId}';`),'1');
    console.log(`Concurrent ${kind} creation: observed lock, first commit wins, second rejected with 23505`);
  } finally {
    // Scope termination/deletion to this run's two named sessions and UUIDs.
    winner?.child.stdin.end();
    loser?.child.stdin.end();
    sql(`select pg_terminate_backend(pid) from pg_stat_activity
      where application_name in ('${winnerName}','${loserName}') and pid<>pg_backend_pid();`);
    await Promise.all([winner?.done,loser?.done]);
    sql(`delete from public.invitations where id in ('${winnerId}','${loserId}');
      delete from auth.users where id='${subject}';`);
  }
}
await concurrentCreation('email');
await concurrentCreation('subject');
assert.equal(sql(snapshotQuery),before,'Concurrency fixtures changed existing memberships or Auth fields');
console.log('Invitation concurrency fixtures removed; existing accounts and memberships preserved');

async function confirmationRace(kind) {
  const subject=randomUUID(),invitation=randomUUID(),attempt=randomUUID(),authSession=randomUUID(),renewOperation=randomUUID();
  const email=`${subject}@example.invalid`,admin='11111111-1111-4111-8111-111111111111';
  const firstName=`volo122_${kind}_first`,secondName=`volo122_${kind}_second`;
  let first,second;
  const accept=`select public.record_verified_invitation_setup('${subject}','${email}','${authSession}','https://confirm.example.invalid',repeat('a',64),'${invitation}',1,'${attempt}',repeat('b',64),'recovery')->>'code';`;
  const renew=`select public.reserve_invitation_resend('${renewOperation}','${invitation}',1,'${admin}')->>'code';`;
  try {
    ownership();
    sql(`insert into auth.users(id,email,email_confirmed_at) values ('${subject}','${email}',now());
      insert into auth.sessions(id,user_id) values ('${authSession}','${subject}');
      insert into public.invitations(id,recipient_email,auth_user_id,invited_by_user_id,status) values ('${invitation}','${email}','${subject}','${admin}','issued');
      insert into public.invitation_send_attempts(id,invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at) values ('${attempt}','${invitation}',1,'${admin}','resend','accepted',now());
      insert into public.invitation_send_proofs(attempt_id,secret_digest,transport) values ('${attempt}',repeat('b',64),'recovery');`);
    if(kind==='cleanup'){
      assert.equal(sql(accept),'recorded');
      sql(`update public.invitation_setup_authorizations set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where invitation_id='${invitation}';`);
      first=session(firstName,`begin;select 1 from public.invitations where id='${invitation}' for update;\n\\echo winner_ready`,{hold:true});
    }else first=session(firstName,`begin;${kind==='renew'?renew:accept}\n\\echo winner_ready`,{hold:true});
    await until(()=>first.ready()||first.finished(),'Confirmation winner did not become ready');assert.ok(first.ready());
    second=session(secondName,kind==='cleanup'?'select public.cleanup_invitation_confirmation();':accept);
    await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Confirmation race did not overlap');
    assert.equal(second.finished(),false,'Competing transaction must block');
    if(kind==='cleanup'){
      first.child.stdin.write(`delete from public.invitation_setup_authorizations where invitation_id='${invitation}';
        insert into public.invitation_setup_authorizations(id,lookup_digest,invitation_id,invitation_version,verified_user_id,session_id,origin,created_at,expires_at) values ('${renewOperation}',repeat('c',64),'${invitation}',1,'${subject}','${authSession}','https://confirm.example.invalid',now(),now()+interval '30 minutes');
        update public.invitations set setup_authorization_id='${renewOperation}' where id='${invitation}';\n`);
    }
    first.child.stdin.end('commit;\n');const winner=await first.done,loser=await second.done;assert.equal(winner.code,0);assert.equal(loser.code,0);
    if(kind==='accept'){
      assert.equal(winner.stdout.trim(),'recorded\nwinner_ready');assert.equal(loser.stdout.trim(),'stale');
      assert.equal(sql(`select count(*) from public.invitation_setup_authorizations where invitation_id='${invitation}';`),'1');
      assert.equal(sql(`select consumed_at is not null from public.invitation_send_proofs where attempt_id='${attempt}';`),'t');
    }else if(kind==='renew'){
      assert.equal(loser.stdout.trim(),'stale');assert.equal(sql(`select count(*) from public.invitation_setup_authorizations where invitation_id='${invitation}';`),'0');
    }else{
      assert.equal(sql(`select i.status='setup_verified' and i.setup_authorization_id=s.id and s.id='${renewOperation}' from public.invitations i join public.invitation_setup_authorizations s on s.invitation_id=i.id where i.id='${invitation}';`),'t','Cleanup must preserve newer setup correlation');
    }
    assert.equal(sql(`select count(*) from public.memberships where user_id='${subject}';`),'0');
    console.log(`Confirmation ${kind} race: observed lock, current authority fenced, no membership`);
  }finally{
    first?.child.stdin.end();second?.child.stdin.end();
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
    await Promise.all([first?.done,second?.done]);
    sql(`delete from public.invitation_setup_authorizations where invitation_id='${invitation}';delete from public.invitation_send_proofs where attempt_id in ('${attempt}','${renewOperation}');delete from public.invitation_send_attempts where invitation_id='${invitation}';delete from public.invitations where id='${invitation}';delete from auth.sessions where user_id='${subject}';delete from auth.users where id='${subject}';`);
  }
}
// VOLO-153: only the missing real-overlap cases; sequential denial and rollback
// coverage stays in invitation_redemption.test.sql.
async function redemptionRace(kind) {
  const subject=randomUUID(),invitation=randomUUID(),authSession=randomUUID(),operation=randomUUID();
  const email=`${subject}@example.invalid`,origin='https://redeem.example.invalid';
  const admin='11111111-1111-4111-8111-111111111111';
  const firstName=`volo153_${kind}_first`,secondName=`volo153_${kind}_second`;
  let first,second;
  try {
    ownership();
    sql(`insert into auth.users(id,email,email_confirmed_at) values ('${subject}','${email}',now());
      insert into auth.sessions(id,user_id) values ('${authSession}','${subject}');
      insert into public.invitations(id,recipient_email,auth_user_id,invited_by_user_id,status) values ('${invitation}','${email}','${subject}','${admin}','issued');
      insert into public.invitation_send_attempts(invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at) values ('${invitation}',1,'${admin}','initial','accepted',now());`);
    assert.equal(sql(`select public.record_verified_invitation_setup('${subject}','${email}','${authSession}','${origin}',repeat('d',64),'${invitation}',1,null,null,'invite')->>'code';`),'recorded');
    sql(`update public.invitations set status='password_established',password_established_at=clock_timestamp(),updated_at=clock_timestamp() where id='${invitation}';`);
    const authority=sql(`select setup_authorization_id from public.invitations where id='${invitation}';`);
    const redeem=`select public.redeem_invitation('${invitation}',1,'${authority}',repeat('d',64),'${subject}','${email}','${authSession}','${origin}')->>'code';`;
    const renew=`select public.reserve_invitation_resend('${operation}','${invitation}',1,'${admin}')->>'code';`;
    const expire=`update public.invitation_setup_authorizations set created_at=now()-interval '31 minutes',expires_at=now()-interval '1 minute' where id='${authority}';`;
    const snapshot=`select json_build_object('invitation',(select to_jsonb(i) from public.invitations i where id='${invitation}'),'membership',(select to_jsonb(m) from public.memberships m where user_id='${subject}'));`;
    if(kind==='cleanup_first')sql(expire);
    // Cleanup's initial scan must see a committed expiry. Redeem while valid,
    // then hold its transaction across that expiry before starting cleanup.
    if(kind==='redeem_cleanup')sql(`update public.invitation_setup_authorizations set created_at=now()-interval '30 minutes'+interval '5 seconds',expires_at=now()+interval '5 seconds' where id='${authority}';`);
    const firstQuery=kind==='renew_first'?renew:kind==='cleanup_first'?'select public.cleanup_invitation_confirmation();':redeem;
    first=session(firstName,`begin;${firstQuery}${kind==='retry'?snapshot:''}\n\\echo winner_ready`,{hold:true});
    await until(()=>first.ready()||first.finished(),'Redemption winner did not become ready');assert.ok(first.ready(),'First transaction failed before overlap');
    if(kind==='redeem_cleanup')await until(()=>sql(`select expires_at<=clock_timestamp() from public.invitation_setup_authorizations where id='${authority}';`)==='t','Committed authority expiry did not pass');
    assert.equal(sql(`select count(*) from public.memberships where user_id='${subject}';`),'0','Uncommitted redemption granted access');
    const secondQuery=kind==='redeem_renew'?renew:kind==='redeem_cleanup'?'select public.cleanup_invitation_confirmation();':redeem;
    second=session(secondName,secondQuery);
    await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Redemption race did not overlap');
    assert.equal(second.finished(),false,'Competing operation must wait on the first transaction');
    first.child.stdin.end(kind==='rollback'?'rollback;\n':'commit;\n');
    const winner=await first.done,loser=await second.done;
    assert.equal(winner.code,0,'First transaction failed');assert.equal(loser.code,0,'Competing operation failed');
    const expected={retry:'already_redeemed',rollback:'redeemed',redeem_renew:'stale',renew_first:'conflict',cleanup_first:'conflict',redeem_cleanup:''};
    assert.equal(loser.stdout.trim(),expected[kind]);
    if(kind==='renew_first'||kind==='cleanup_first'){
      assert.equal(sql(`select count(*) from public.memberships where user_id='${subject}';`),'0');
      assert.equal(sql(`select status::text||':'||version||':'||(redeemed_at is null)::text from public.invitations where id='${invitation}';`),kind==='renew_first'?'pending_issuance:2:true':'issued:1:true');
    }else{
      assert.equal(sql(`select count(*) from public.memberships where user_id='${subject}' and role='member' and status='active';`),'1');
      assert.equal(sql(`select status='redeemed' and redeemed_at>=password_established_at from public.invitations where id='${invitation}';`),'t');
      if(kind==='retry')assert.equal(sql(snapshot),winner.stdout.trim().split('\n')[1],'Concurrent identical retry changed completion records');
      if(kind==='redeem_cleanup')assert.equal(sql(`select count(*) from public.invitation_setup_authorizations where id='${authority}';`),'0','Cleanup failed to remove expired completion context');
    }
    assert.equal(winner.stdout.trim().split('\n')[0],kind==='renew_first'?'reserved':kind==='cleanup_first'?'winner_ready':'redeemed');
    console.log(`Redemption ${kind}: observed PostgreSQL lock overlap, no access before commit, final invariant preserved`);
  }finally{
    first?.child.stdin.end();second?.child.stdin.end();
    sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
    await Promise.all([first?.done,second?.done]);
    sql(`delete from public.memberships where user_id='${subject}';delete from public.invitation_setup_authorizations where invitation_id='${invitation}';delete from public.invitation_send_attempts where invitation_id='${invitation}';delete from public.invitations where id='${invitation}';delete from auth.sessions where user_id='${subject}';delete from auth.users where id='${subject}';`);
  }
}

async function passwordReservationRace() {
 const subject=randomUUID(),invitation=randomUUID(),authSession=randomUUID(),operation=randomUUID();
 const email=`${subject}@example.invalid`,admin='11111111-1111-4111-8111-111111111111';
 const firstName='volo124_reservation_first',secondName='volo124_reservation_second';
 let first,second;
 const begin=id=>`select public.begin_invitation_completion('${id}',repeat('c',64),'${subject}','${email}','${authSession}','https://complete.example.invalid')->>'code';`;
 try {
  ownership();
  sql(`insert into auth.users(id,email,email_confirmed_at) values ('${subject}','${email}',now());
   insert into auth.sessions(id,user_id) values ('${authSession}','${subject}');
   insert into public.invitations(id,recipient_email,auth_user_id,invited_by_user_id,status) values ('${invitation}','${email}','${subject}','${admin}','issued');
   insert into public.invitation_send_attempts(invitation_id,invitation_version,requested_by_user_id,kind,outcome,completed_at) values ('${invitation}',1,'${admin}','initial','accepted',now());`);
  assert.equal(sql(`select public.record_verified_invitation_setup('${subject}','${email}','${authSession}','https://complete.example.invalid',repeat('c',64),'${invitation}',1,null,null,'invite')->>'code';`),'recorded');
  const authority=sql(`select setup_authorization_id from public.invitations where id='${invitation}';`);
  first=session(firstName,`begin;${begin(operation)}\n\\echo winner_ready`,{hold:true});
  await until(()=>first.ready()||first.finished(),'Password reservation did not become ready');assert.ok(first.ready());
  second=session(secondName,begin(randomUUID()));
  await until(()=>sql(`select exists(select 1 from pg_stat_activity w join pg_stat_activity h on h.pid=any(pg_blocking_pids(w.pid)) where w.application_name='${secondName}' and h.application_name='${firstName}' and w.wait_event_type='Lock');`)==='t'||second.finished(),'Competing password reservation never blocked');
  assert.equal(second.finished(),false);
  first.child.stdin.end('commit;\n');const winner=await first.done,loser=await second.done;
  assert.equal(winner.code,0);assert.equal(loser.code,0);assert.match(winner.stdout,/^reserved$/m);assert.equal(loser.stdout.trim(),'busy');
  assert.equal(sql(`select count(*) from public.memberships where user_id='${subject}';`),'0');
  assert.equal(sql(`select public.reserve_invitation_resend('${randomUUID()}','${invitation}',1,'${admin}')->>'code';`),'reserved');
  assert.equal(sql(`select public.record_invitation_password('${operation}','${invitation}',1,'${authority}',repeat('c',64),'${subject}','${email}','${authSession}','https://complete.example.invalid')->>'code';`),'denied');
  assert.equal(sql(`select count(*) from public.memberships where user_id='${subject}';`),'0');
  console.log('Password reservation: observed overlap, competitor busy, renewal fences stale evidence, no membership');
 } finally {
  first?.child.stdin.end();second?.child.stdin.end();
  sql(`select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('${firstName}','${secondName}') and pid<>pg_backend_pid();`);
  await Promise.all([first?.done,second?.done]);
  sql(`delete from public.invitation_setup_authorizations where invitation_id='${invitation}';delete from public.invitation_send_attempts where invitation_id='${invitation}';delete from public.invitations where id='${invitation}';delete from auth.sessions where user_id='${subject}';delete from auth.users where id='${subject}';`);
 }
}

const raceJob=Number(sql("select jobid from cron.job where jobname='volo-invitation-confirmation-cleanup';"));
assert.ok(Number.isSafeInteger(raceJob));
sql(`select cron.alter_job(${raceJob},active:=false);`);
try{await passwordReservationRace();await confirmationRace('accept');await confirmationRace('renew');await confirmationRace('cleanup');
 for(const kind of ['retry','rollback','redeem_renew','renew_first','cleanup_first','redeem_cleanup'])await redemptionRace(kind);}
finally{sql(`select cron.alter_job(${raceJob},active:=true);`);}

// Accelerate only this disposable database's existing named job, then restore
// its production five-minute schedule. No HTTP request invokes the cleanup.
const cleanupJob=Number(sql("select jobid from cron.job where jobname='volo-invitation-confirmation-cleanup';"));
assert.ok(Number.isSafeInteger(cleanupJob));
const idleDigest=randomUUID().replaceAll('-','').padEnd(64,'0');
try {
  sql(`insert into public.invitation_confirmation_transports(lookup_digest,csrf_digest,origin,created_at,expires_at,key_id,nonce,ciphertext,tag) values ('${idleDigest}',repeat('b',64),'https://idle.example.invalid',now()-interval '11 minutes',now()-interval '1 minute','fixture',repeat('A',16),repeat('A',100),repeat('A',22));select cron.alter_job(${cleanupJob},schedule:='1 second');`);
  await until(()=>sql(`select count(*)=0 from public.invitation_confirmation_transports where lookup_digest='${idleDigest}';`)==='t','Scheduled idle cleanup did not execute');
  console.log('Scheduled database cleanup erased idle encrypted transport without HTTP traffic');
}finally{sql(`select cron.alter_job(${cleanupJob},schedule:='*/5 * * * *');delete from public.invitation_confirmation_transports where lookup_digest='${idleDigest}';`);}
assert.equal(sql(snapshotQuery),before,'Confirmation fixtures changed existing accounts or memberships');
