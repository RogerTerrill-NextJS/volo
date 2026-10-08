import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
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
  assert.ok(versions.length>0 && versions.every(v=>['20261006040000','20261008010000'].includes(v)),'Unexpected migration history');
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
assert.deepEqual(JSON.parse(sql('select json_agg(version order by version) from supabase_migrations.schema_migrations;')),['20261006040000','20261008010000']);
run(process.execPath,[cli,'test','db','--local']);
console.log('Prior-schema upgrade, fixture preservation and database regressions passed');
