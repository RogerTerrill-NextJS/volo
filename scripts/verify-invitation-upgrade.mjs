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
  assert.ok(versions.length>0 && versions.every(v=>['20261006040000','20261008010000','20261008020000','20261009010000','20261009020000','20261009030000'].includes(v)),'Unexpected migration history');
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
assert.deepEqual(JSON.parse(sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;')),['20261006040000','20261008010000','20261008020000','20261009010000','20261009020000','20261009030000']);
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
