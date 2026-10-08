import {execFile} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const idPattern=/^volo-auth-[a-f0-9-]{36}$/;
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const evidenceDirectory=root=>path.join(root,'.superpowers/sdd/2026-10-07-volo-119-auth-integration');

export function localProcessEnvironment(source=process.env) {
  const env={NEXT_TELEMETRY_DISABLED:'1',CI:'true'};
  for(const key of ['PATH','HOME','TMPDIR','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_CONFIG','XDG_RUNTIME_DIR'])if(source[key])env[key]=source[key];
  return env;
}

export function validateLocalApiUrl(value,expectedPort) {
  // Reject URL parser normalization of integer/octal/short-form loopback hosts.
  if(typeof value!=='string'||!/^http:\/\/(127\.0\.0\.1|\[::1\]):[0-9]+\/?$/.test(value))throw new Error('Invalid owned local API destination');
  const url=new URL(value);
  if(url.port!==String(expectedPort)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid owned local API destination');
  return url;
}

export function sanitizeDiagnostics(value,secrets=[]) {
  let text=String(value);
  for(const secret of secrets.filter(Boolean).sort((a,b)=>b.length-a.length))text=text.split(secret).join('[redacted]');
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted]')
    .replace(/((?:service_role|service_role_key|anon_key|password|refresh_token|access_token|authorization)\s*["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s,"'}]+/gi,'$1[redacted]');
}

export async function reservePort() {
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const {port}=server.address();await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));return port;
}

function replaceSetting(config,section,key,value) {
  let current='',count=0;
  const lines=config.split('\n').map(line=>{
    const header=line.match(/^\[([^\]]+)\]/);if(header)current=header[1];
    if(current===section&&new RegExp(`^${key}\\s*=`).test(line)){count++;return `${key} = ${value}`;}return line;
  });
  if(count!==1)throw new Error('Local Auth configuration shape changed');return lines.join('\n');
}

async function prepareConfig(root,workdir,projectId,jwtExpirySeconds,allocate) {
  let config=await readFile(path.join(root,'supabase/config.toml'),'utf8');
  config=replaceSetting(config,'','project_id',JSON.stringify(projectId));
  config=replaceSetting(config,'auth','jwt_expiry',String(jwtExpirySeconds));
  // CLI maps email.enable_signup to GOTRUE_EXTERNAL_EMAIL_ENABLED.
  // Permit password sign-in for Admin-created users; global signup stays disabled.
  config=replaceSetting(config,'auth','enable_signup','false');
  config=replaceSetting(config,'auth.email','enable_signup','true');
  config=replaceSetting(config,'db.seed','enabled','false');
  config=replaceSetting(config,'db.seed','sql_paths','[]');
  config=replaceSetting(config,'auth','site_url','"http://127.0.0.1"');
  config=replaceSetting(config,'auth','additional_redirect_urls','[]');
  // Disabled optional integrations must not read developer/provider secrets.
  config=config.replace(/"env\([A-Z0-9_]+\)"/g,'""');
  let apiPort;let section='';const ports=new Set();const lines=[];
  for(let line of config.split('\n')) {
    const header=line.match(/^\[([^\]]+)\]/);if(header)section=header[1];
    const match=line.match(/^(port|shadow_port|inspector_port)\s*=/);
    if(match){let port;do{port=await allocate();}while(ports.has(port));ports.add(port);line=`${match[1]} = ${port}`;if(section==='api'&&match[1]==='port')apiPort=port;}
    lines.push(line);
  }
  if(!apiPort)throw new Error('Local Auth API port missing');
  await mkdir(path.join(workdir,'supabase'),{recursive:true});
  await writeFile(path.join(workdir,'supabase/config.toml'),lines.join('\n'));
  await cp(path.join(root,'supabase/migrations'),path.join(workdir,'supabase/migrations'),{recursive:true});
  return apiPort;
}

function cliRunner(root,run,signal) {
  return (args,timeout=600000)=>run(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),...args],{
    cwd:root,env:localProcessEnvironment(),timeout,maxBuffer:16*1024*1024,signal,
  });
}

// Dependency injection is restricted to this test infrastructure; normal entry uses real operations.
export async function createLocalAuthStack({repositoryRoot,stateFile=path.join(evidenceDirectory(repositoryRoot),'owned-stack.json'),jwtExpirySeconds=120,signal},adapters={}) {
  if(jwtExpirySeconds!==120)throw new Error('Integration JWT lifetime must be 120 seconds');
  const run=adapters.run??exec,request=adapters.fetch??fetch,allocate=adapters.reservePort??reservePort;
  const cli=cliRunner(repositoryRoot,run,signal),cleanupCli=cliRunner(repositoryRoot,run);
  try{await (adapters.checkDocker??(()=>exec('docker',['info','--format','{{.ServerVersion}}'],{env:localProcessEnvironment(),timeout:15000})))();}
  catch{throw new Error('Real local Auth stack requires a running Docker engine; no simulated fallback');}
  signal?.throwIfAborted();
  const projectId=`volo-auth-${randomUUID()}`,workdir=await mkdtemp(path.join(tmpdir(),`${projectId}-`));
  const accounts=[],secrets=[];let started=false,stateOwned=false,apiUrl,publicKey,adminKey,closePromise,stage='configuration';
  async function api(route,{method='GET',body}={}) {
    validateLocalApiUrl(apiUrl,Number(new URL(apiUrl).port));
    try{
      const response=await request(apiUrl+route,{method,headers:{apikey:adminKey,Authorization:`Bearer ${adminKey}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok){const error=new Error('rejected');error.httpStatus=response.status;throw error;}
      const text=await response.text();return text?JSON.parse(text):null;
    }catch(cause){const error=new Error(`Rejected local Auth operation (${method})`);error.operation=route.startsWith('/auth/')?'auth-user':'membership';error.httpStatus=cause.httpStatus;throw error;}
  }
  const close=()=>closePromise??=(async()=>{
    let failed=false;
    if(apiUrl&&adminKey)for(const account of accounts){
      try{await api(`/rest/v1/memberships?user_id=eq.${account.id}`,{method:'DELETE'});await api(`/auth/v1/admin/users/${account.id}`,{method:'DELETE'});}catch{failed=true;}
    }
    let stopped=!started;
    if(started)try{await cleanupCli(['stop','--workdir',workdir,'--project-id',projectId,'--no-backup'],120000);stopped=true;}catch{failed=true;}
    if(stopped){await rm(workdir,{recursive:true,force:true});if(stateOwned)await rm(stateFile,{force:true});}
    if(failed)throw new Error('Owned local Auth stack cleanup failed; retry integration --cleanup');
  })();
  try {
    signal?.throwIfAborted();
    const apiPort=await prepareConfig(repositoryRoot,workdir,projectId,jwtExpirySeconds,allocate);
    await mkdir(path.dirname(stateFile),{recursive:true});
    await writeFile(stateFile,JSON.stringify({projectId,workdir}),{flag:'wx',mode:0o600});
    stateOwned=true;
    signal?.throwIfAborted();
    stage='start';started=true;await cli(['start','--workdir',workdir]);
    stage='status';
    const result=await cli(['status','--workdir',workdir,'-o','json'],30000);
    stage='credentials';const status=JSON.parse(result.stdout);
    apiUrl=validateLocalApiUrl(status.API_URL,apiPort).origin;
    publicKey=status.PUBLISHABLE_KEY;adminKey=status.SERVICE_ROLE_KEY;
    if(typeof publicKey!=='string'||!publicKey.startsWith('sb_publishable_')||typeof adminKey!=='string'||!adminKey)throw new Error('Local keys missing');
    secrets.push(adminKey);
    const owned=new Set();
    const requireOwned=id=>{if(!owned.has(id))throw new Error('Account is not owned by this run');};
    const membership=(role,status)=>({role,status,disabled_at:status==='disabled'?new Date().toISOString():null,disabled_reason:status==='disabled'?'Integration fixture':null});
    return {
      projectId,workdir,apiUrl,publicKey,close,
      assertNoCredentialLeaks(text){if(secrets.some(secret=>text.includes(secret)))throw new Error('Integration credential leak detected');},
      async createAccount({label,role,status='active'}) {
        if(!/^[A-Za-z0-9-]+$/.test(label)||![null,'member','admin'].includes(role)||!['active','disabled'].includes(status))throw new Error('Invalid account fixture');
        const email=`${label.toLowerCase()}-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');secrets.push(password);
        const response=await api('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}});
        const user=response?.user??response;
        if(!uuidPattern.test(user?.id))throw new Error('Local Auth user identity invalid');
        const account={id:user.id,email,password};accounts.push(account);owned.add(account.id);
        if(role!==null)await api('/rest/v1/memberships',{method:'POST',body:{user_id:account.id,...membership(role,status)}});
        return account;
      },
      async setMembership(id,{role,status}) {
        requireOwned(id);if(!['member','admin'].includes(role)||!['active','disabled'].includes(status))throw new Error('Invalid membership fixture');
        await api(`/rest/v1/memberships?user_id=eq.${id}`,{method:'PATCH',body:membership(role,status)});
      },
      async readMembership(id){requireOwned(id);return (await api(`/rest/v1/memberships?user_id=eq.${id}&select=*`))?.[0]??null;},
    };
  }catch{
    try{await close();}catch{throw new Error('Real local Auth stack setup and cleanup failed; run integration --cleanup');}
    const error=new Error('Real local Auth stack setup failed; captured credentials were not logged');error.setupStage=stage;throw error;
  }
}

export const startLocalAuthStack=options=>createLocalAuthStack(options);

export async function cleanupOwnedStack(repositoryRoot) {
  const stateFile=path.join(evidenceDirectory(repositoryRoot),'owned-stack.json');
  let state;try{state=JSON.parse(await readFile(stateFile,'utf8'));}catch(error){if(error.code==='ENOENT')return;throw new Error('Invalid owned stack state');}
  if(!idPattern.test(state.projectId)||typeof state.workdir!=='string'||path.dirname(state.workdir)!==tmpdir()||!path.basename(state.workdir).startsWith(state.projectId+'-'))throw new Error('Refusing unowned stack cleanup');
  const config=await readFile(path.join(state.workdir,'supabase/config.toml'),'utf8');
  if(!config.includes(`project_id = "${state.projectId}"`))throw new Error('Owned stack configuration mismatch');
  try{await cliRunner(repositoryRoot,exec)(['stop','--workdir',state.workdir,'--project-id',state.projectId,'--no-backup'],120000);}catch{throw new Error('Owned stack stop failed');}
  await rm(state.workdir,{recursive:true,force:true});await rm(stateFile,{force:true});
}
