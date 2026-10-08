import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {startLocalAuthStack,cleanupOwnedStack,evidenceDirectory} from '../tests/helpers/local-auth-stack.mjs';
import {signInSession,invalidSession} from '../tests/helpers/real-auth-session.mjs';
import {startRealAuthApp} from '../tests/helpers/real-auth-app.mjs';

const root=path.resolve(import.meta.dirname,'..');
const summary={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),versions:{node:process.version,next:'16.3.8',supabaseCli:'2.119.0'},scenarios:[],limitations:['Local fixture headers do not prove Netlify CDN storage behavior (VOLO-120).','Hosted authenticated writes and browser history are not exercised.']};
const cancellation=new AbortController();const interrupt=()=>{process.exitCode=130;cancellation.abort();};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
let stack,app,setupStage='stack';const sessions=[];
const check=(condition,message)=>assert.ok(condition,message);
async function scenario(name,run){try{const evidence=await run();summary.scenarios.push({name,status:'passed',...(evidence?{evidence}:{})});console.log(`PASS ${name}`);}catch(error){summary.scenarios.push({name,status:'failed',evidence:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:'Service/transport failure'});throw new Error(`Integration scenario failed: ${name}`);}}
function privatePolicy(response){
  check(/no-store/.test(response.headers.get('cache-control')??''),'browser no-store');
  for(const field of ['cdn-cache-control','netlify-cdn-cache-control'])check(response.headers.get(field)==='no-store','CDN no-store');
}
function assertClean(text){stack.assertNoCredentialLeaks(text);for(const session of sessions)session.assertNoCredentialLeaks(text);}
try{
  if(process.argv.includes('--cleanup')){await cleanupOwnedStack(root);}else{
    stack=await startLocalAuthStack({repositoryRoot:root,signal:cancellation.signal});
    setupStage='fixture';app=await startRealAuthApp({repositoryRoot:root,stack,signal:cancellation.signal});
    setupStage='accounts';const accounts={},users={};
    const fresh=async label=>{const session=await signInSession(stack,accounts[label]);sessions.push(session);return session;};
    const audit=async(response,subject)=>{
      const body=await response.clone().text(),headers=new Headers(response.headers);headers.delete('set-cookie');assertClean(body);assertClean(JSON.stringify([...headers]));
      for(const label of ['A','B','admin','disabled','absent'])if(users[label]&&accounts[label].id!==subject){check(!body.includes(accounts[label].id),'foreign subject in body');users[label].assertNoCredentialLeaks(response.headers.getSetCookie().join('\n'));}
      return response;
    };
    const expected=options=>{try{return options.expectedUserId??options.session?.userId;}catch{return undefined;}};
    const read=async(route,options={})=>{const subject=expected(options);return audit(await app.request(route,options),subject);};
    const mutate=async(transport,options={})=>{const subject=expected(options);return audit(await app.mutate(transport,options),subject);};
    const deny=async(transport,session,options={})=>{
      const before=app.effects().length,diagnosticStart=app.diagnostics().length,response=await mutate(transport,{session,...options}),body=await response.text();
      check(app.effects().length===before,'rejected mutation effect');check(!body.includes('"saved":true'),'rejected mutation success payload');
      if(transport==='json')check([401,403].includes(response.status),'JSON denial status');
      else {
        const originRejected=Object.hasOwn(options,'origin')&&options.origin!==app.origin;
        if(originRejected&&options.origin!==null&&response.status===500)check(/Invalid Server Actions request/.test(app.diagnostics().slice(diagnosticStart)),'framework CSRF rejection');
        else if(transport==='native'&&response.status===307)check(new URL(response.headers.get('location'),app.origin).pathname==='/login','native authentication redirect');
        else {check(response.status===200,'Action denial transport');const normalized=body.replaceAll('&quot;','\"');check(/\"code\":\"(?:unauthenticated|forbidden)\"/.test(normalized),'semantic Action denial');}
      }
      return response;
    };
    const success=async(transport,session,options={})=>{
      const before=app.effects().length,response=await mutate(transport,{session,...options});privatePolicy(response);
      check(response.status===200,'successful mutation status');check(app.effects().length===before+1,'exactly one effect');check(app.effects().at(-1).userId===session.userId,'effect subject');
      const body=await response.text();if(transport!=='native')check(body.includes('"saved":true'),'successful effect payload');return response;
    };
    const page=async(session,headers={})=>{
      let route='/dashboard';for(let i=0;i<3;i++){
        const response=await read(route,{session,headers}),body=await response.text();
        if(response.status===307){const target=new URL(response.headers.get('location'),app.origin);check(target.origin===app.origin,'canonical origin');if(target.pathname==='/dashboard'&&target.searchParams.has('_rsc')){route=target.pathname+target.search;continue;}}
        return {response,body};
      }throw new Error('RSC negotiation failed');
    };
    for(const [label,role,status] of [['A','member','active'],['B','member','active'],['admin','admin','active'],['disabled','member','disabled'],['absent',null,'active']]){
      accounts[label]=await stack.createAccount({label,role,status});users[label]=await fresh(label);
    }
    await scenario('admission',async()=>{
      for(const label of ['A','B','admin']){const response=await read('/api/subject',{session:users[label]});privatePolicy(response);check(response.status===200,'admission status');const data=await response.json();check(data.userId===accounts[label].id,'admission subject');check(data.role===(label==='admin'?'admin':'member'),'admission role');}
      for(const label of ['disabled','absent']){const response=await read('/api/subject',{session:users[label]});check(response.status===403,'membership denial');const result=await page(users[label]);check(result.body.includes('Access denied'),'denied HTML');for(const transport of ['json','native','fetched'])await deny(transport,users[label]);}
      check((await read('/api/subject')).status===401,'anonymous JSON');
      const anonymous=await read('/dashboard');const body=await anonymous.text();privatePolicy(anonymous);
      check(anonymous.status===307?new URL(anonymous.headers.get('location'),app.origin).href===app.origin+'/login?reason=authentication-required':body.includes('/login?reason=authentication-required'),'fixed login destination');
      for(const transport of ['json','native','fetched']){await deny(transport,undefined);await deny(transport,users.A,{admin:true});await success(transport,users.A);await success(transport,users.admin,{admin:true});}
    });
    if(!process.argv.includes('--scenario')){
      await scenario('current_membership',async()=>{
        const retained=users.A.cookieHeader();await stack.setMembership(accounts.A.id,{role:'member',status:'disabled'});
        check((await read('/api/subject',{session:users.A})).status===403,'disabled current row');check(users.A.cookieHeader()===retained,'unchanged credentials');for(const transport of ['json','native','fetched'])await deny(transport,users.A);
        await stack.setMembership(accounts.A.id,{role:'member',status:'active'});check((await read('/api/subject',{session:users.A})).status===200,'reactivated membership');await success('json',users.A);
      });
      await scenario('role_downgrade',async()=>{
        const retained=users.admin.cookieHeader();await stack.setMembership(accounts.admin.id,{role:'member',status:'active'});
        for(const transport of ['json','native','fetched'])await deny(transport,users.admin,{admin:true});check(users.admin.cookieHeader()===retained,'unchanged admin credentials');
        await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});await success('json',users.admin,{admin:true});
      });
      await scenario('real_rls',async()=>{
        for(const label of ['A','admin']){
          const session=users[label],own=await session.membership('GET',accounts[label].id),foreign=await session.membership('GET',accounts.B.id);
          check(own.status===200&&own.rows.length===1&&own.rows[0].user_id===accounts[label].id,'own RLS row');check(foreign.status===200&&foreign.rows.length===0,'foreign RLS row');
          for(const [method,target,body] of [['POST','absent',{user_id:accounts.absent.id,role:'member',status:'active'}],['PATCH',label,{role:'admin'}],['PATCH','disabled',{status:'active',disabled_at:null,disabled_reason:null}],['DELETE',label,undefined]]){
            const before=JSON.stringify(await stack.readMembership(accounts[target].id));const result=await session.membership(method,accounts[target].id,body);
            check(result.status>=400||Array.isArray(result.rows)&&result.rows.length===0,'RLS write rejection');check(JSON.stringify(await stack.readMembership(accounts[target].id))===before,'RLS row unchanged');
          }
        }
      });
      for(const [name,mode] of [['malformed_session','malformed'],['corrupted_signature','signature']])await scenario(name,async()=>{
        const invalid=invalidSession(await fresh('A'),mode);sessions.push(invalid);
        check((await read('/api/subject',{session:invalid})).status===401,'invalid credential status');await deny('json',invalid);
      });
      await scenario('explicit_refresh',async()=>{
        const session=await fresh('A'),before=session.cookieHeader(),retained=session.clone();sessions.push(retained);await session.refresh();
        check(session.cookieHeader()!==before,'real credential rotation');check(retained.cookieHeader()===before,'retained jar isolation');check((await read('/api/subject',{session})).status===200,'refreshed access');
      });
      await scenario('parallel_identity_isolation',async()=>{
        const exercise=async(label)=>{const session=label?users[label]:undefined;
          for(const headers of [{Accept:'text/html'},{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}]){const {response,body}=await page(session,headers);privatePolicy(response);if(session&&!headers['Next-Router-Prefetch'])check(body.includes(accounts[label].id),headers.RSC?'own navigation RSC subject':'own HTML subject');if(!session)check(!/subject:/.test(body),'anonymous private content');}
          const response=await read('/api/subject',{session});privatePolicy(response);check(response.status===(session?200:401),'isolated JSON status');
        };
        for(const label of ['A','B',null,'B','A',null])await exercise(label);
        await Promise.all(['A','B',null].map(exercise));
        const before=app.effects().length;await Promise.all([mutate('json',{session:users.A}),mutate('fetched',{session:users.B})]);
        const callers=app.effects().slice(before).map(x=>x.userId);check(callers.length===2&&callers.includes(accounts.A.id)&&callers.includes(accounts.B.id),'concurrent effect callers');
      });
      await scenario('origin_matrix',async()=>{
        for(const transport of ['json','native','fetched']){for(const origin of [null,'https://foreign.example.invalid','null']){const response=await deny(transport,users.A,{origin});privatePolicy(response);}await success(transport,users.A);}
      });
      await scenario('private_cache',async()=>{
        for(const session of [users.A,users.B,users.disabled,undefined]){privatePolicy(await read('/api/subject',{session}));const result=await page(session);privatePolicy(result.response);}
        const publicResponse=await read('/');check(publicResponse.status===200,'public control');check(!/no-store/.test(publicResponse.headers.get('cache-control')??''),'public cacheability');
        const html=await publicResponse.text(),asset=html.match(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/)?.[1];check(Boolean(asset),'static control asset');const staticResponse=await read(asset);check(staticResponse.status===200,'static control status');check(/max-age|immutable/.test(staticResponse.headers.get('cache-control')??''),'static cacheability');
      });
      await scenario('retained_credentials_after_logout',async()=>{
        const session=await fresh('A'),retained=session.clone();sessions.push(retained);await session.signOut();const observations=await retained.probeRetainedCredentials();
        check(observations.refresh==='rejected','revoked refresh cannot establish session');
        const application=await read('/api/subject',{session:retained});
        // The guard promises current verified user + membership, not instant JWT revocation.
        check(application.status===(observations.user==='accepted'?200:401),'application matches real Auth user verification');
        if(observations.user==='rejected')await deny('json',retained);
        return {...observations,application:application.status===200?'accepted':'rejected',contract:'Unexpired access-token acceptance is measured separately from refresh revocation.'};
      });
      await scenario('natural_expiry',async()=>{
        const started=Date.now(),valid=await fresh('A'),independent=await fresh('B'),invalid=invalidSession(await fresh('B'),'refresh');sessions.push(invalid);
        const concurrent=[valid,valid.clone(),valid.clone()];sessions.push(...concurrent.slice(1));
        const before=valid.cookieHeader(),wait=Math.max(valid.expiresAt,independent.expiresAt,invalid.expiresAt)*1000+2000-Date.now();check(wait>0&&wait<=180000,'bounded real expiry');
        // Short waits allow a cancellation signal to reach owned cleanup promptly.
        let remaining=wait;while(remaining>0){const step=Math.min(remaining,1000);await delay(step,undefined,{signal:cancellation.signal});remaining-=step;}
        await Promise.all([...concurrent.map(session=>({session,id:accounts.A.id})),{session:independent,id:accounts.B.id}].map(async({session,id})=>{
          const response=await read('/api/subject',{session,expectedUserId:id});privatePolicy(response);check(response.status===200,'concurrent expired refresh recovered');check((await response.json()).userId===id,'immutable refresh subject');
          check(response.headers.getSetCookie().length>0&&session.cookieHeader()!==before,'Proxy persisted rotated cookies');
          const next=await read('/api/subject',{session,expectedUserId:id});check(next.status===200&&(await next.json()).userId===id,'next request identity from returned cookies');
        }));
        const bad=await read('/api/subject',{session:invalid});privatePolicy(bad);check(bad.status===401,'expired invalid refresh denied');await deny('json',invalid);check(Date.now()-started<=240000,'expiry scenario deadline');
        return {accessLifetimeSeconds:120,waitBoundSeconds:180,scenarioBoundSeconds:240};
      });
      await scenario('credential_leaks',async()=>{await app.scanStatic(assertClean);assertClean(app.diagnostics());});
    }
  }
}catch(error){
  if(error.fixtureDiagnostic)summary.fixtureDiagnostic=error.fixtureDiagnostic;
  if(error.operation)summary.setupOperation={operation:error.operation,status:error.httpStatus??'transport',...(error.authCode?{code:error.authCode}:{})};
  console.error(`Setup stage: ${setupStage}`);
  const missingDocker=error.message==='Real local Auth stack requires a running Docker engine; no simulated fallback';
  console.error(error.message.startsWith('Integration scenario failed:')||missingDocker?error.message:'Real Auth integration failed during setup or cleanup; no credentials logged');process.exitCode=1;
  if(!summary.scenarios.some(x=>x.status==='failed'))summary.scenarios.push({name:'setup',status:'failed',evidence:missingDocker?'Docker unavailable':`Service/fixture setup failed (${['configuration','start','status','credentials'].includes(error.setupStage)?error.setupStage:setupStage}); raw output withheld`});
}
finally{
  try{await app?.close();}catch{process.exitCode=1;summary.scenarios.push({name:'fixture_cleanup',status:'failed'});}
  try{await stack?.close();}catch{process.exitCode=1;summary.scenarios.push({name:'stack_cleanup',status:'failed'});}
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
  if(!process.argv.includes('--cleanup')){await mkdir(evidenceDirectory(root),{recursive:true});await writeFile(path.join(evidenceDirectory(root),'summary.json'),JSON.stringify(summary,null,2)+'\n');}
}
