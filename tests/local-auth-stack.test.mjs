import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const load=()=>import('./helpers/local-auth-stack.mjs');

test('rejects_non_owned_destinations',async()=>{
  const {validateLocalApiUrl}=await load();
  for(const url of ['broken','https://example.supabase.co','http://127.0.0.1.evil:40001','http://u:p@127.0.0.1:40001','http://127.0.0.1:40002','http://127.0.0.1:40001/a','http://127.0.0.1:40001/?x=1','http://2130706433:40001']) {
    assert.throws(()=>validateLocalApiUrl(url,40001),undefined,'unsafe destination accepted');
  }
  assert.equal(validateLocalApiUrl('http://127.0.0.1:40001',40001).origin,'http://127.0.0.1:40001');
});

test('does_not_inherit_hosted_settings',async()=>{
  const {localProcessEnvironment}=await load();
  const result=localProcessEnvironment({PATH:'/bin',HOME:'/home/test',SUPABASE_ACCESS_TOKEN:'private',NEXT_PUBLIC_SUPABASE_URL:'https://remote.invalid',SMTP_PASSWORD:'secret'});
  assert.equal(result.PATH,'/bin');
  for(const key of ['SUPABASE_ACCESS_TOKEN','NEXT_PUBLIC_SUPABASE_URL','SMTP_PASSWORD'])assert.equal(result[key],undefined);
});

async function harness({failAt,redirect=false}={}) {
  const {createLocalAuthStack}=await load();
  const directory=await mkdtemp(path.join(tmpdir(),'volo-auth-test-'));
  const calls=[],requests=[];let nextPort=40000;
  const stateFile=path.join(directory,'state.json');
  const adapters={
    reservePort:async()=>++nextPort,
    run:async(command,args,options)=>{
      calls.push({command,args,options});
      if(args[1]===failAt)throw new Error('service_role=unknown-private-canary');
      if(args[1]==='status')return {stdout:JSON.stringify({API_URL:'http://127.0.0.1:40001',ANON_KEY:'public-canary',SERVICE_ROLE_KEY:'admin-canary'}),stderr:''};
      return {stdout:'',stderr:''};
    },
    checkDocker:async()=>{},
    fetch:async(url,options)=>{
      requests.push({url:String(url),options});
      if(redirect)return new Response(null,{status:302,headers:{location:'https://remote.invalid'}});
      if(String(url).endsWith('/auth/v1/admin/users')&&options.method==='POST')return Response.json({id:'00000000-0000-4000-8000-000000000001'});
      return Response.json([]);
    },
  };
  return {calls,requests,stateFile,start:()=>createLocalAuthStack({repositoryRoot:root,stateFile},adapters),dispose:()=>rm(directory,{recursive:true,force:true})};
}

test('cleanup_after_partial_start',async()=>{
  for(const failAt of ['start','status']) {
    const h=await harness({failAt});
    try {
      await assert.rejects(h.start(),/local Auth stack/i);
      const stops=h.calls.filter(x=>x.args[1]==='stop');assert.equal(stops.length,1);
      const args=stops[0].args;assert.ok(args.includes('--no-backup'));assert.ok(args.includes('--project-id'));assert.ok(!args.includes('--all'));
      assert.match(args[args.indexOf('--project-id')+1],/^volo-auth-[a-f0-9-]{36}$/);
      assert.notEqual(args[args.indexOf('--workdir')+1],root);
    } finally {await h.dispose();}
  }
});

test('membership_deleted_before_user_and_cleanup_is_idempotent',async()=>{
  const h=await harness();
  try {
    const stack=await h.start();
    const config=await readFile(path.join(stack.workdir,'supabase/config.toml'),'utf8');
    assert.match(config,/jwt_expiry = 120/);
    const account=await stack.createAccount({label:'A',role:'member',status:'active'});
    assert.match(account.email,/@example\.invalid$/);
    const state=await readFile(h.stateFile,'utf8');assert.ok(!state.includes('admin-canary'));assert.ok(!state.includes(account.password));
    await stack.close();await stack.close();
    const deletes=h.requests.filter(x=>x.options.method==='DELETE');
    assert.equal(deletes.length,2);assert.match(deletes[0].url,/rest\/v1\/memberships/);assert.match(deletes[1].url,/auth\/v1\/admin\/users/);
    assert.equal(h.calls.filter(x=>x.args[1]==='stop').length,1);
    assert.ok(h.requests.every(x=>x.options.redirect==='error'));
  } finally {await h.dispose();}
});

test('redirect_never_creates_an_account_or_follows_foreign_destination',async()=>{
  const h=await harness({redirect:true});
  try {const stack=await h.start();await assert.rejects(stack.createAccount({label:'A',role:'member',status:'active'}),/local Auth operation/);await stack.close();assert.equal(h.requests.length,1);}finally{await h.dispose();}
});

test('redacts_failed_cli_output_and_secret_canaries',async()=>{
  const {sanitizeDiagnostics}=await load();
  const sanitized=sanitizeDiagnostics('known-password service_role=unknown-key Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def',['known-password']);
  for(const secret of ['known-password','unknown-key','eyJhbGciOiJIUzI1NiJ9'])assert.ok(!sanitized.includes(secret));
  const h=await harness();
  try{const stack=await h.start();assert.throws(()=>stack.assertNoCredentialLeaks('admin-canary'),/credential leak/i);await stack.close();}finally{await h.dispose();}
});

test('existing_ownership_state_is_not_deleted_on_setup_failure',async()=>{
  const h=await harness();
  try{await writeFile(h.stateFile,'other-run');await assert.rejects(h.start());assert.equal(await readFile(h.stateFile,'utf8'),'other-run');assert.equal(h.calls.length,0);}finally{await h.dispose();}
});
