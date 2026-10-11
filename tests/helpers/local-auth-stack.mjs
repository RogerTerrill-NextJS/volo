import {execFile} from 'node:child_process';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const exec=promisify(execFile);
const idPattern=/^volo-auth-(?:[a-f0-9]{24}|[a-f0-9-]{36})$/;
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

async function prepareConfig(root,workdir,projectId,jwtExpirySeconds,allocate,applicationOrigin) {
  let config=await readFile(path.join(root,'supabase/config.toml'),'utf8');
  config=replaceSetting(config,'','project_id',JSON.stringify(projectId));
  config=replaceSetting(config,'auth','jwt_expiry',String(jwtExpirySeconds));
  // Inherit admission/provider policy unchanged so runtime checks catch drift.
  config=replaceSetting(config,'db.seed','enabled','false');
  config=replaceSetting(config,'db.seed','sql_paths','[]');
  config=replaceSetting(config,'auth','site_url',JSON.stringify(applicationOrigin));
  config=replaceSetting(config,'auth','additional_redirect_urls',JSON.stringify([applicationOrigin+'/auth/confirm']));
  // Disabled optional integrations must not read developer/provider secrets.
  config=config.replace(/"env\([A-Z0-9_]+\)"/g,'""');
  let apiPort,mailPort;let section='';const ports=new Set();const lines=[];
  for(let line of config.split('\n')) {
    const header=line.match(/^\[([^\]]+)\]/);if(header)section=header[1];
    const match=line.match(/^(port|shadow_port|inspector_port)\s*=/);
    if(match){let port;do{port=await allocate();}while(ports.has(port));ports.add(port);line=`${match[1]} = ${port}`;if(section==='api'&&match[1]==='port')apiPort=port;if(section==='local_smtp'&&match[1]==='port')mailPort=port;}
    lines.push(line);
  }
  if(!apiPort)throw new Error('Local Auth API port missing');
  await mkdir(path.join(workdir,'supabase'),{recursive:true});
  await writeFile(path.join(workdir,'supabase/config.toml'),lines.join('\n'));
  await cp(path.join(root,'supabase/migrations'),path.join(workdir,'supabase/migrations'),{recursive:true});
  await cp(path.join(root,'supabase/templates'),path.join(workdir,'supabase/templates'),{recursive:true});
  return {apiPort,mailPort};
}

function cliRunner(root,run,signal) {
  return (args,timeout=600000)=>run(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),...args],{
    cwd:root,env:localProcessEnvironment(),timeout,maxBuffer:16*1024*1024,signal,
  });
}

// Dependency injection is restricted to this test infrastructure; normal entry uses real operations.
export async function createLocalAuthStack({repositoryRoot,stateFile=path.join(evidenceDirectory(repositoryRoot),'owned-stack.json'),jwtExpirySeconds=120,signal,applicationOrigin='http://127.0.0.1:3000'},adapters={}) {
  if(jwtExpirySeconds!==120)throw new Error('Integration JWT lifetime must be 120 seconds');
  if(!/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(applicationOrigin))throw new Error('Invalid owned application origin');
  validateLocalApiUrl(applicationOrigin,Number(new URL(applicationOrigin).port));
  const run=adapters.run??exec,request=adapters.fetch??fetch,allocate=adapters.reservePort??reservePort;
  const cli=cliRunner(repositoryRoot,run,signal),cleanupCli=cliRunner(repositoryRoot,run);
  try{await (adapters.checkDocker??(()=>exec('docker',['info','--format','{{.ServerVersion}}'],{env:localProcessEnvironment(),timeout:15000})))();}
  catch{throw new Error('Real local Auth stack requires a running Docker engine; no simulated fallback');}
  signal?.throwIfAborted();
  // The CLI truncates project IDs at 40 characters; keep start/stop identities equal.
  const projectId=`volo-auth-${randomBytes(12).toString('hex')}`,workdir=await mkdtemp(path.join(tmpdir(),`${projectId}-`));
  const accounts=[],secrets=[],ownedEmails=new Set(),ownedInvitations=new Set();let started=false,stateOwned=false,apiUrl,publicKey,adminKey,serverSecret,mailUrl,closePromise,stage='configuration';
  async function ownedFixtureSql(sql){
    const state=JSON.parse(await readFile(stateFile,'utf8')),config=await readFile(path.join(workdir,'supabase/config.toml'),'utf8');
    if(!stateOwned||state.projectId!==projectId||state.workdir!==workdir||!config.includes(`project_id = "${projectId}"`))throw new Error('Database ownership mismatch');
    try{await cli(['db','query','--local','--workdir',workdir,sql],30000);}
    catch{const error=new Error('Owned fixture SQL rejected');error.operation='owned-fixture-sql';throw error;}
  }
  async function api(route,{method='GET',body}={}) {
    validateLocalApiUrl(apiUrl,Number(new URL(apiUrl).port));
    try{
      const response=await request(apiUrl+route,{method,headers:{apikey:adminKey,Authorization:`Bearer ${adminKey}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
      if(!response.ok){const error=new Error('rejected');error.httpStatus=response.status;throw error;}
      const text=await response.text();return text?JSON.parse(text):null;
    }catch(cause){const error=new Error(`Rejected local Auth operation (${method})`);error.operation=route.startsWith('/auth/')?'auth-user':'membership';error.httpStatus=cause.httpStatus;throw error;}
  }
  const close=()=>closePromise??=(async()=>{
    let failed=false,cleanupStage='database-owner',failedStage,cleanupDiagnostic;
    if(apiUrl&&adminKey)try{
      const state=JSON.parse(await readFile(stateFile,'utf8'));
      const config=await readFile(path.join(workdir,'supabase/config.toml'),'utf8');
      if(!stateOwned||state.projectId!==projectId||state.workdir!==workdir||!config.includes(`project_id = "${projectId}"`))throw new Error('Database ownership mismatch');
      cleanupStage='database-rows';await cleanupCli(['db','query','--local','--workdir',workdir,
        `do $cleanup$ begin create temporary table owned_subjects as select id from public.invitation_send_attempts where kind='initial';
         if to_regclass('public.password_recovery_authorizations') is not null then delete from public.password_recovery_authorizations; end if; delete from public.invitation_confirmation_transports; delete from public.invitation_setup_authorizations; delete from public.invitation_send_proofs; delete from public.invitation_send_attempts; delete from public.invitations;
         drop table if exists public.volo_test_auth_snapshot;
         delete from public.memberships where user_id in (select id from owned_subjects);
         delete from auth.users where id in (select id from owned_subjects); end $cleanup$;`],30000);
    }catch(cause){failed=true;failedStage=cleanupStage;if(cleanupStage==='database-rows'&&typeof cause.stderr==='string')cleanupDiagnostic=sanitizeDiagnostics(cause.stderr,secrets).replace(/postgres(?:ql)?:\/\/[^\s'"]+/g,'[redacted database URL]').slice(-3000);}
    if(apiUrl&&adminKey)for(const account of accounts){
      try{await api(`/rest/v1/memberships?user_id=eq.${account.id}`,{method:'DELETE'});await api(`/auth/v1/admin/users/${account.id}`,{method:'DELETE'});}catch{failed=true;}
    }
    let stopped=!started;
    if(started)try{await cleanupCli(['stop','--workdir',workdir,'--project-id',projectId,'--no-backup'],120000);stopped=true;}catch{failed=true;}
    if(stopped){await rm(workdir,{recursive:true,force:true});if(stateOwned)await rm(stateFile,{force:true});}
    if(failed){const error=new Error('Owned local Auth stack cleanup failed; retry integration --cleanup');error.cleanupStage=failedStage??'accounts-or-stop';error.cleanupDiagnostic=cleanupDiagnostic;throw error;}
  })();
  try {
    signal?.throwIfAborted();
    const {apiPort,mailPort}=await prepareConfig(repositoryRoot,workdir,projectId,jwtExpirySeconds,allocate,applicationOrigin);
    await mkdir(path.dirname(stateFile),{recursive:true});
    await writeFile(stateFile,JSON.stringify({projectId,workdir}),{flag:'wx',mode:0o600});
    stateOwned=true;
    signal?.throwIfAborted();
    stage='start';started=true;await cli(['start','--workdir',workdir]);
    stage='status';
    const result=await cli(['status','--workdir',workdir,'-o','json'],30000);
    stage='credentials';const status=JSON.parse(result.stdout);
    apiUrl=validateLocalApiUrl(status.API_URL,apiPort).origin;
    publicKey=status.PUBLISHABLE_KEY;adminKey=status.SERVICE_ROLE_KEY;serverSecret=status.SECRET_KEY;
    if(typeof publicKey!=='string'||!publicKey.startsWith('sb_publishable_')||typeof adminKey!=='string'||!adminKey||typeof serverSecret!=='string'||!/^sb_secret_[A-Za-z0-9_-]+$/.test(serverSecret))throw new Error('Local keys missing');
    secrets.push(adminKey,serverSecret);
    mailUrl=validateLocalApiUrl(status.MAILPIT_URL,mailPort).origin;
    const owned=new Set();
    const requireOwned=id=>{if(!owned.has(id))throw new Error('Account is not owned by this run');};
    const membership=(role,status)=>({role,status,disabled_at:status==='disabled'?new Date().toISOString():null,disabled_reason:status==='disabled'?'Integration fixture':null});
    return {
      projectId,workdir,apiUrl,publicKey,serverSecret,close,
      async authFailureCategory(){
        // Read only this generated project's bounded logs. Export categories,
        // never provider messages, request URLs, tokens or credential values.
        try{
          const container=`supabase_auth_${projectId}`,env=localProcessEnvironment();
          const owner=await exec('docker',['inspect','--format','{{ index .Config.Labels "com.supabase.cli.project" }}',container],{env,timeout:5000});
          if(owner.stdout.trim()!==projectId)throw new Error('Unowned diagnostic target');
          const logs=await exec('docker',['logs','--tail','100',container],{env,timeout:5000,maxBuffer:1024*1024});const text=logs.stdout+logs.stderr;
          return {templateContext:/ambiguous context|different contexts/i.test(text),templateError:/templatemailer|template.*(?:error|failed)/i.test(text),rateLimit:/email rate limit exceeded|over_email_send_rate_limit/i.test(text)};
        }catch{return {unavailable:true};}
      },
      ownInvitationEmail(email){
        if(typeof email!=='string'||!/^[A-Za-z0-9.+-]+@example\.invalid$/i.test(email.trim()))throw new Error('Invalid fictional invitation email');
        ownedEmails.add(email.trim().toLowerCase());return email;
      },
      async readInvitationForEmail(email){
        const key=email.trim().toLowerCase();if(!ownedEmails.has(key))throw new Error('Invitation email not owned');
        const rows=await api(`/rest/v1/invitations?recipient_email_key=eq.${encodeURIComponent(key)}&select=*`);
        if(rows.length>1)throw new Error('Duplicate owned invitation');const row=rows[0]??null;if(row)ownedInvitations.add(row.id);return row;
      },
      async readSendAttempts(id){if(!ownedInvitations.has(id))throw new Error('Invitation not owned');return api(`/rest/v1/invitation_send_attempts?invitation_id=eq.${id}&select=*`);},
      async readCapturedInvites(email){
        const key=email.trim().toLowerCase();if(!ownedEmails.has(key))throw new Error('Invitation email not owned');
        async function mail(route){const response=await request(mailUrl+route,{redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error('Owned mail capture failed');return response.json();}
        const list=await mail('/api/v1/messages');if(!Array.isArray(list.messages))throw new Error('Owned mail capture shape changed');
        const results=[];
        for(const item of list.messages.filter(m=>m.To?.some(to=>to.Address?.toLowerCase()===key))){
          if(typeof item.ID!=='string'||!(/^[A-Za-z0-9]{22}$/.test(item.ID)||uuidPattern.test(item.ID)))throw new Error('Owned mail identity invalid');
          const message=await mail(`/api/v1/message/${item.ID}`);const html=message.HTML;
          if(typeof html!=='string')throw new Error('Owned mail HTML missing');
          for(const match of html.matchAll(/(?:token_hash|resume)=([A-Za-z0-9_-]+)/g))secrets.push(match[1]);
          results.push(html);
        }
        return results;
      },
      async readAuthUser(id){requireOwned(id);return api(`/auth/v1/admin/users/${id}`);},
      async readSendProof(attemptId){
        const attempts=await api(`/rest/v1/invitation_send_attempts?id=eq.${attemptId}&select=invitation_id`);
        if(!uuidPattern.test(attemptId)||attempts.length!==1||!ownedInvitations.has(attempts[0].invitation_id))throw new Error('Attempt not owned');
        return (await api(`/rest/v1/invitation_send_proofs?attempt_id=eq.${attemptId}&select=*`))[0]??null;
      },
      async verifyCapturedLink(email,html){
        if(!ownedEmails.has(email.toLowerCase()))throw new Error('Email not owned');
        const href=html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&');const link=new URL(href);
        const token=link.searchParams.get('token_hash'),type=link.searchParams.get('type'),resume=link.searchParams.get('resume');
        if(link.origin!==applicationOrigin||link.pathname!=='/auth/confirm'||!token||!['invite','recovery'].includes(type))throw new Error('Invalid owned callback');
        if(resume&&!/^[A-Za-z0-9_-]{43}$/.test(resume))throw new Error('Invalid owned proof');
        secrets.push(token,...(resume?[resume]:[]));const data=await api('/auth/v1/verify',{method:'POST',body:{token_hash:token,type}});
        for(const key of ['access_token','refresh_token'])if(typeof data[key]==='string')secrets.push(data[key]);
        requireOwned(data.user?.id);return {subjectId:data.user.id,resume,type};
      },
      async consumeSendProof(attemptId,version,subjectId,secret,transport){
        requireOwned(subjectId);if(!uuidPattern.test(attemptId)||!Number.isSafeInteger(version)||version<1||!['invite','recovery'].includes(transport))throw new Error('Invalid owned proof arguments');
        return api('/rest/v1/rpc/consume_invitation_send_proof',{method:'POST',body:{p_attempt_id:attemptId,p_expected_version:version,p_verified_subject:subjectId,p_secret_digest:createHash('sha256').update(secret).digest('hex'),p_transport:transport}});
      },
      async revokeInvitation(id,adminId){
        if(!ownedInvitations.has(id))throw new Error('Invitation not owned');requireOwned(adminId);
        await api(`/rest/v1/invitations?id=eq.${id}`,{method:'PATCH',body:{status:'revoked',revoked_at:new Date().toISOString(),revoked_by_user_id:adminId,revocation_reason:'Owned test'}});
      },
      async setInvitationTestState(id,mode,replacementId){
        if(!uuidPattern.test(id)||!ownedInvitations.has(id))throw new Error('Invitation not owned');
        if(mode==='old')return api(`/rest/v1/invitations?id=eq.${id}`,{method:'PATCH',body:{created_at:'2000-01-01T00:00:00Z'}});
        if(mode==='expired-setup')return ownedFixtureSql(`update public.invitation_setup_authorizations set created_at=statement_timestamp()-interval '31 minutes',expires_at=statement_timestamp()-interval '1 minute' where invitation_id='${id}';`);
        if(mode==='superseded'){
          if(!uuidPattern.test(replacementId)||!ownedInvitations.has(replacementId)||replacementId===id)throw new Error('Replacement not owned');
          return api(`/rest/v1/invitations?id=eq.${id}`,{method:'PATCH',body:{status:'superseded',superseded_at:new Date().toISOString(),superseded_by_id:replacementId}});
        }
        if(mode!=='expired-provider')throw new Error('Invalid invitation fixture state');
        // Backdate only the owned provider issuance timestamp; real Auth verifies expiry.
        await ownedFixtureSql(`update auth.users set confirmation_sent_at='2000-01-01' where id=(select auth_user_id from public.invitations where id='${id}');`);
      },
      async expireRecovery(id){
        requireOwned(id);await ownedFixtureSql(`update public.password_recovery_authorizations set created_at=statement_timestamp()-interval '31 minutes',expires_at=statement_timestamp()-interval '1 minute' where subject='${id}';`);
      },
      async assertSetupLifetime(id){
        if(!uuidPattern.test(id)||!ownedInvitations.has(id))throw new Error('Invitation not owned');
        await ownedFixtureSql(`do $check$ begin if not exists(select 1 from public.invitation_setup_authorizations where invitation_id='${id}' and expires_at=created_at+interval '30 minutes' and expires_at>clock_timestamp()) then raise exception 'Owned setup lifetime mismatch'; end if; end $check$;`);
      },
      async createOwnedSessionLink(id){
        requireOwned(id);const user=await api(`/auth/v1/admin/users/${id}`);
        const data=await api('/auth/v1/admin/generate_link',{method:'POST',body:{type:'magiclink',email:user.email}});
        if(data.id!==id||typeof data.hashed_token!=='string'||!data.hashed_token)throw new Error('Owned session link rejected');
        secrets.push(data.hashed_token);return data.hashed_token;
      },
      async setOwnedAuthEmail(id,email){
        requireOwned(id);if(!ownedEmails.has(email.trim().toLowerCase()))throw new Error('Email not owned');
        await api(`/auth/v1/admin/users/${id}`,{method:'PUT',body:{email,email_confirm:true}});
      },
      async checkpointAuth(id,verify=false){
        requireOwned(id);if(!uuidPattern.test(id))throw new Error('Invalid owned subject');
        // Disposable-only SQL checks password/confirmation/ban/role without
        // returning any credential hash to Node or diagnostic output.
        const sql=verify?`do $check$ begin if not exists(select 1 from public.volo_test_auth_snapshot s join auth.users u using(id) where s.id='${id}' and s.snapshot=jsonb_build_array(u.encrypted_password,u.email_confirmed_at,u.banned_until,u.raw_app_meta_data)) or exists(select 1 from public.memberships where user_id='${id}') then raise exception 'Owned account changed'; end if; end $check$;`
          :`do $check$ begin create table if not exists public.volo_test_auth_snapshot(id uuid primary key,snapshot jsonb); revoke all on public.volo_test_auth_snapshot from public,anon,authenticated,service_role; insert into public.volo_test_auth_snapshot select id,jsonb_build_array(encrypted_password,email_confirmed_at,banned_until,raw_app_meta_data) from auth.users where id='${id}' on conflict(id) do update set snapshot=excluded.snapshot; end $check$;`;
        const state=JSON.parse(await readFile(stateFile,'utf8'));const config=await readFile(path.join(workdir,'supabase/config.toml'),'utf8');
        if(!stateOwned||state.projectId!==projectId||state.workdir!==workdir||!config.includes(`project_id = "${projectId}"`))throw new Error('Database ownership mismatch');
        try{await cli(['db','query','--local','--workdir',workdir,sql],30000);}catch{throw new Error('Owned Auth state assertion failed');}
      },
      async trackIssuedSubject(id){
        if(!uuidPattern.test(id))throw new Error('Invalid owned subject');
        const attempts=await api(`/rest/v1/invitation_send_attempts?id=eq.${id}&select=invitation_id`);
        if(attempts.length!==1||!ownedInvitations.has(attempts[0].invitation_id))throw new Error('Subject not owned by invitation');
        owned.add(id); // Owner SQL removes initial subjects before ordinary account cleanup.
      },
      assertNoCredentialLeaks(text){if(secrets.some(secret=>text.includes(secret)))throw new Error('Integration credential leak detected');},
      async probePublicAdmission() {
        validateLocalApiUrl(apiUrl,Number(new URL(apiUrl).port));
        const password=randomBytes(32).toString('base64url');secrets.push(password);
        async function publicRequest(route,body) {
          const response=await request(apiUrl+route,{method:body===undefined?'GET':'POST',
            headers:{apikey:publicKey,'content-type':'application/json'},
            body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
          const data=await response.json();
          for(const key of ['access_token','refresh_token'])if(typeof data[key]==='string')secrets.push(data[key]);
          // Preserve cleanup even if a regression unexpectedly admits a public user.
          const user=data.user??data;
          if(uuidPattern.test(user?.id)&&!owned.has(user.id)){owned.add(user.id);accounts.push({id:user.id});}
          return {response,data};
        }
        const {response:settingsResponse,data:settings}=await publicRequest('/auth/v1/settings');
        if(!settingsResponse.ok || !settings.external || typeof settings.external!=='object')throw new Error('Local Auth settings unavailable');
        const providers=Object.fromEntries(Object.entries(settings.external).map(([name,value])=>{
          if(!/^[a-z_]+$/.test(name)||typeof value!=='boolean')throw new Error('Invalid local provider settings');
          return [name,value];
        }));
        const outcome=({response,data})=>({status:response.status,
          code:typeof (data.error_code??data.code)==='string'&&/^[a-z_]{1,64}$/.test(data.error_code??data.code)?(data.error_code??data.code):'unknown',
          hasIdentity:uuidPattern.test((data.user??data)?.id),hasSession:Boolean(data.access_token||data.refresh_token||data.session)});
        const email=outcome(await publicRequest('/auth/v1/signup',{
          email:`uninvited-${randomUUID()}@example.invalid`,password,data:{role:'admin',status:'active'},
        }));
        const anonymous=outcome(await publicRequest('/auth/v1/signup',{}));
        const oauth=outcome(await publicRequest('/auth/v1/authorize?provider=apple'));
        return {settings:{signupDisabled:settings.disable_signup,providers},email,anonymous,oauth};
      },
      async createAccount({label,role,status='active',emailConfirmed=true}) {
        if(!/^[A-Za-z0-9-]+$/.test(label)||![null,'member','admin'].includes(role)||!['active','disabled'].includes(status))throw new Error('Invalid account fixture');
        const email=`${label.toLowerCase()}-${randomUUID()}@example.invalid`,password=randomBytes(32).toString('base64url');secrets.push(password);
        const response=await api('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:emailConfirmed}});
        const user=response?.user??response;
        if(!uuidPattern.test(user?.id))throw new Error('Local Auth user identity invalid');
        const account={id:user.id,email,password};accounts.push(account);owned.add(account.id);ownedEmails.add(email.toLowerCase());
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
