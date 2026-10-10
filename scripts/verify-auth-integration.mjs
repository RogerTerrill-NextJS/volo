import assert from 'node:assert/strict';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {startLocalAuthStack,cleanupOwnedStack,evidenceDirectory,reservePort} from '../tests/helpers/local-auth-stack.mjs';
import {signInSession,signInOwnedInvitationSession,invalidSession,emptySession} from '../tests/helpers/real-auth-session.mjs';
import {startRealAuthApp} from '../tests/helpers/real-auth-app.mjs';

const root=path.resolve(import.meta.dirname,'..');
const summary={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),versions:{node:process.version,next:'16.3.8',supabaseCli:'2.119.0'},scenarios:[],limitations:['Local fixture headers do not prove Netlify CDN storage behavior (VOLO-120).','Hosted authenticated writes and browser history are not exercised.','Provider/setup expiry and invitation age use backdated owned timestamps, not a 30-minute wall-clock wait.']};
const cancellation=new AbortController();const interrupt=()=>{process.exitCode=130;cancellation.abort();};process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
let stack,app,setupStage='stack',diagnosticStage='scenario';const sessions=[],invitationPasswords=new Set();
const check=(condition,message)=>assert.ok(condition,message);
async function scenario(name,run){try{const evidence=await run();summary.scenarios.push({name,status:'passed',...(evidence?{evidence}:{})});console.log(`PASS ${name}`);}catch(error){summary.scenarios.push({name,status:'failed',evidence:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:`Service/transport failure (${diagnosticStage}; ${error.operation??'unknown'}; ${Number.isInteger(error.httpStatus)?error.httpStatus:'no-status'})`});throw new Error(`Integration scenario failed: ${name}`);}}
function privatePolicy(response){
  check(/no-store/.test(response.headers.get('cache-control')??''),'browser no-store');
  for(const field of ['cdn-cache-control','netlify-cdn-cache-control'])check(response.headers.get(field)==='no-store','CDN no-store');
}
function assertClean(text){stack.assertNoCredentialLeaks(text);for(const session of sessions)session.assertNoCredentialLeaks(text);for(const password of invitationPasswords)check(!text.includes(password),'invitation password must not leak');}
try{
  if(process.argv.includes('--cleanup')){await cleanupOwnedStack(root);}else{
    const applicationOrigin=`http://127.0.0.1:${await reservePort()}`;
    stack=await startLocalAuthStack({repositoryRoot:root,signal:cancellation.signal,applicationOrigin});
    await scenario('invitation_only_admission_configuration',async()=>{
      const result=await stack.probePublicAdmission();
      check(result.settings.signupDisabled===true,'global public signup disabled');
      check(result.settings.providers.email===true,'email/password authentication enabled');
      check(result.settings.providers.phone===false&&result.settings.providers.anonymous_users===false,'phone and anonymous providers disabled');
      for(const [name,enabled] of Object.entries(result.settings.providers))if(name!=='email')check(enabled===false,'unused provider disabled');
      for(const outcome of [result.email,result.anonymous,result.oauth]){
        check(outcome.status>=400&&outcome.status<500,'direct admission request rejected');
        check(!outcome.hasIdentity&&!outcome.hasSession,'no public identity/session issued');
      }
      check(result.email.code==='signup_disabled','email signup rejected by admission policy');
      return 'Owned real Auth settings plus direct public email/anonymous/OAuth requests; no identity or session issued.';
    });
    setupStage='fixture';app=await startRealAuthApp({repositoryRoot:root,stack,signal:cancellation.signal,applicationOrigin});
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
    const page=async(session,headers={},route='/dashboard')=>{for(let i=0;i<3;i++){
        const response=await read(route,{session,headers}),body=await response.text();
        if(response.status===307){const target=new URL(response.headers.get('location'),app.origin);check(target.origin===app.origin,'canonical origin');if(target.pathname===new URL(route,app.origin).pathname&&target.searchParams.has('_rsc')){route=target.pathname+target.search;continue;}}
        return {response,body};
      }throw new Error('RSC negotiation failed');
    };
    for(const [label,role,status] of [['A','member','active'],['B','member','active'],['admin','admin','active'],['disabled','member','disabled'],['absent',null,'active']]){
      accounts[label]=await stack.createAccount({label,role,status});users[label]=await fresh(label);
    }
    await scenario('native_password_login',async()=>{
      const loginPage=await read('/login');privatePolicy(loginPage);const html=await loginPage.text();
      check(/<form[^>]*action="\/auth\/login"[^>]*method="post"/.test(html),'native login form');
      check(/name="email"/.test(html)&&/name="password"/.test(html),'login fields');
      const calls=async()=>Number((await (await read('/api/login-control')).json()).calls);
      const post=async(session,body,headers={Origin:app.origin},route='/auth/login')=>read(route,{session,method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body});
      const payload=label=>new URLSearchParams({email:accounts[label].email,password:accounts[label].password}).toString();
      const before=await calls();
      for(const [body,headers,route,status] of [
        [payload('A'),{},'/auth/login',403],
        [payload('A'),{Origin:'https://foreign.example.invalid'},'/auth/login',403],
        [payload('A'),{Origin:app.origin,'Sec-Fetch-Site':'cross-site'},'/auth/login',403],
        [payload('A')+'&email=other@example.invalid',{Origin:app.origin},'/auth/login',303],
        ['email=bad&password=x',{Origin:app.origin},'/auth/login',303],
        [payload('A'),{Origin:app.origin},'/auth/login?next=https://foreign.example.invalid',303],
        ['x'.repeat(4097),{Origin:app.origin},'/auth/login',303],
        [JSON.stringify({email:accounts.A.email,password:accounts.A.password}),{Origin:app.origin,'content-type':'application/json'},'/auth/login',303],
      ]){
        const session=emptySession(stack),response=await post(session,body,headers,route);sessions.push(session);
        privatePolicy(response);check(response.status===status,'login origin/input rejection');check(response.headers.getSetCookie().length===0&&session.cookieHeader()==='','rejected login has no session');
        if(status===303)check(response.headers.get('location')===app.origin+'/login?result=invalid_input','fixed safe input destination');
      }
      check(await calls()===before,'login policy rejects before provider');
      for(const method of ['GET','HEAD','OPTIONS']){const response=await read('/auth/login',{method});privatePolicy(response);check(response.status===405&&response.headers.get('allow')==='POST','login only supports POST');}
      invitationPasswords.add('wrong-password-canary');
      for(const input of [{email:accounts.A.email,password:'wrong-password-canary'},{email:`missing-${randomUUID()}@example.invalid`,password:'wrong-password-canary'}]){
        const session=emptySession(stack);sessions.push(session);const response=await post(session,new URLSearchParams(input).toString());privatePolicy(response);
        check(response.headers.get('location')===app.origin+'/login?result=invalid_credentials','generic invalid credentials destination');check(session.cookieHeader()==='','failed login creates no session');
      }
      for(const mode of ['outage','malformed']){
        await read('/api/login-control',{method:'POST',body:mode});const start=await calls(),session=emptySession(stack);sessions.push(session);
        try{const response=await post(session,payload('A'));privatePolicy(response);check(response.headers.get('location')===app.origin+'/login?result=unavailable','safe provider failure');check(session.cookieHeader()==='','outage/malformed login issues no session');check(await calls()===start+1,'no automatic password retry');}
        finally{await read('/api/login-control',{method:'POST',body:'off'});}
      }
      for(const label of ['A','admin','disabled','absent']){
        const session=emptySession(stack);sessions.push(session);const response=await post(session,payload(label));privatePolicy(response);
        check(response.status===303&&response.headers.get('location')===app.origin+'/dashboard','fixed full-document login destination');
        check(response.headers.getSetCookie().some(v=>v.includes('auth-token'))&&session.userId===accounts[label].id,'real login cookie belongs to caller');
        const member=await read('/api/subject',{session});check(member.status===(['disabled','absent'].includes(label)?403:200),'fresh current membership guard');
        const dashboard=await page(session);privatePolicy(dashboard.response);check(dashboard.body.includes(['disabled','absent'].includes(label)?'Access denied':accounts[label].id),'fresh dashboard authorizes current member');
      }
      const querySecret='login-query-secret-canary';
      for(const headers of [{},{RSC:'1'}]){const response=await read('/login?password='+querySecret+'&next=https://foreign.example.invalid',{headers});privatePolicy(response);const target=response.headers.get('location');check(response.status===303&&target&&new URL(target,app.origin).href===app.origin+'/login?result=invalid_input','canonicalize untrusted login query before HTML/RSC');check(!(await response.text()).includes(querySecret),'no query credential reflection');}
      assertClean(app.diagnostics());
      return 'Native same-origin form, real sign-in cookies and fresh member/admin access; missing/disabled memberships denied, origin/input rejects precede Auth, generic failures and no automatic outage retry.';
    });
    await scenario('admission',async()=>{
      for(const label of ['A','B','admin']){const response=await read('/api/subject',{session:users[label]});privatePolicy(response);check(response.status===200,'admission status');const data=await response.json();check(data.userId===accounts[label].id,'admission subject');check(data.role===(label==='admin'?'admin':'member'),'admission role');}
      for(const label of ['disabled','absent']){const response=await read('/api/subject',{session:users[label]});check(response.status===403,'membership denial');const result=await page(users[label]);check(result.body.includes('Access denied'),'denied HTML');for(const transport of ['json','native','fetched'])await deny(transport,users[label]);}
      check((await read('/api/subject')).status===401,'anonymous JSON');
      const anonymous=await read('/dashboard');const body=await anonymous.text();privatePolicy(anonymous);
      check(anonymous.status===307?new URL(anonymous.headers.get('location'),app.origin).href===app.origin+'/login?reason=authentication-required':body.includes('/login?reason=authentication-required'),'fixed login destination');
      for(const transport of ['json','native','fetched']){await deny(transport,undefined);await deny(transport,users.A,{admin:true});await success(transport,users.A);await success(transport,users.admin,{admin:true});}
    });
    await scenario('editable_metadata_cannot_admit_or_promote',async()=>{
      for(const label of ['absent','disabled','A']){
        const before=JSON.stringify(await stack.readMembership(accounts[label].id));
        await users[label].setAdmissionMetadata();users[label]=await fresh(label);
        check(JSON.stringify(await stack.readMembership(accounts[label].id))===before,'metadata cannot mutate membership');
        const response=await read('/api/subject',{session:users[label]});
        check(response.status===(label==='A'?200:403),'metadata cannot admit absent or disabled membership');
        if(label==='A')check((await response.json()).role==='member','metadata cannot promote role');
        for(const transport of ['json','native','fetched'])await deny(transport,users[label],{admin:true});
      }
      return 'Real self-edited Auth metadata and fresh sessions preserve missing/disabled denial and member role.';
    });
    const ownedEmail=label=>stack.ownInvitationEmail(`${label}-${randomUUID()}@example.invalid`);
    let adminQueryEmail='';
    const issue=async(email,session=users.admin,origin=app.origin,route='/api/invitations')=>{
      const response=await read(route,{session,method:'POST',headers:{'content-type':'application/json',Origin:origin},body:JSON.stringify({email})});
      privatePolicy(response);return {status:response.status,body:await response.json()};
    };
    const captured=async(email,count)=>{
      let messages=[];const deadline=Date.now()+5000;
      do{messages=await stack.readCapturedInvites(email);if(messages.length===count)break;await delay(100);}while(Date.now()<deadline);
      check(messages.length===count,'captured invite count');return messages;
    };
    await scenario('invitation_issuance_authorization',async()=>{
      for(const session of [undefined,users.A,users.disabled]){
        const email=ownedEmail('denied');const outcome=await issue(email,session??null);
        check([401,403].includes(outcome.status),'only active admin may issue');
        check(await stack.readInvitationForEmail(email)===null,'denied request has no reservation');await captured(email,0);
      }
      let email=ownedEmail('origin');check((await issue(email,users.admin,'https://foreign.invalid')).status===403,'wrong origin denied');
      check(await stack.readInvitationForEmail(email)===null,'wrong origin has no reservation');
      await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});
      email=ownedEmail('stale-admin');check((await issue(email)).status===403,'retained admin credentials cannot bypass disabled membership');
      check(await stack.readInvitationForEmail(email)===null,'stale admin has no reservation');
      await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});
      return 'Real guarded requests deny signed-out/member/disabled/stale-admin and foreign-origin issuance.';
    });
    const linkFrom=html=>new URL(html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&'));
    const prepareConfirmation=async(link,session)=>{
      const response=await app.request(link.pathname+link.search,{session});privatePolicy(response);await audit(response);
      check(response.status===303&&response.headers.get('location')===app.origin+'/auth/confirm','provider URL becomes fixed clean location');
      check(response.headers.get('referrer-policy')==='no-referrer','confirmation suppresses referrer');
      const clean=await app.request('/auth/confirm',{session});privatePolicy(clean);const body=await clean.text();assertClean(body);
      check(clean.status===200&&body.includes('Accept invitation'),'clean static acceptance form');
      const csrf=body.match(/name="csrf" value="([A-Za-z0-9_-]{43})"/)?.[1];check(Boolean(csrf),'form has CSRF only');return csrf;
    };
    const postConfirmation=async(session,csrf,requestOrigin=app.origin)=>{
      const response=await app.request('/auth/confirm',{session,method:'POST',headers:{Origin:requestOrigin,'content-type':'application/x-www-form-urlencoded'},body:'csrf='+csrf});privatePolicy(response);await audit(response);return response;
    };
    const confirmedSetup=async(session,invitation)=>{
      check(session.userId===invitation.auth_user_id,'persisted cookie has provider subject');
      const response=await app.request('/api/confirmation-session',{session});privatePolicy(response);const data=await response.json();
      check(data.session.code==='verified'&&data.session.subject===invitation.auth_user_id,'fresh request revalidates Auth subject');
      check(data.setup.status==='authorized'&&data.setup.invitationId===invitation.id,'fresh request reads committed session-bound setup');
      const setupPair=session.cookieHeader().split('; ').find(v=>v.startsWith('volo-setup='));check(Boolean(setupPair),'separate opaque setup cookie persisted');
      const swapped=await app.request('/api/confirmation-session',{headers:{Cookie:users.A.cookieHeader()+'; '+setupPair}});const swappedData=await swapped.json();check(swappedData.setup.status==='denied','another verified subject cannot inherit setup cookie');
      check(await stack.readMembership(invitation.auth_user_id)===null,'confirmation grants no membership');
      const denied=await app.request('/api/subject',{session});check(denied.status===403,'setup recipient cannot enter member API');
    };
    await scenario('invitation_issuance_mail',async()=>{
      diagnosticStage='issue';const email=ownedEmail('New+tag');adminQueryEmail=email.toUpperCase();
      const sendForm=(await app.invitationForms(users.admin)).find(form=>form.kind==='send');check(Boolean(sendForm),'actual send form exists');
      const response=await app.invitationAction(sendForm,{session:users.admin,fields:{email:` ${adminQueryEmail} `}});privatePolicy(response);await audit(response,accounts.admin.id);
      check(response.status===200&&(await response.text()).includes('Accepted for sending'),'actual native UI send accepted');
      diagnosticStage='read-invitation';const invitation=await stack.readInvitationForEmail(email);check(invitation?.status==='issued'&&invitation.version===1,'durable issued generation');
      diagnosticStage='read-attempts';const attempts=await stack.readSendAttempts(invitation.id);check(attempts.length===1&&attempts[0].outcome==='accepted','one accepted attempt');
      check(attempts[0].id===invitation.auth_user_id,'reserved UUID owns provider subject');
      diagnosticStage='track-subject';await stack.trackIssuedSubject(invitation.auth_user_id);diagnosticStage='read-subject';const user=await stack.readAuthUser(invitation.auth_user_id);
      check(user.email===email.toLowerCase(),'real provider stores case/whitespace normalized recipient');
      check(!user.email_confirmed_at,'issuance does not confirm email');diagnosticStage='read-membership';check(await stack.readMembership(invitation.auth_user_id)===null,'issuance grants no membership');
      diagnosticStage='captured-mail';const [html]=await captured(email,1);const href=html.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;','&');check(Boolean(href),'mail has application link');
      const link=new URL(href);check(link.origin===app.origin&&link.pathname==='/auth/confirm','exact direct application callback');
      check(Boolean(link.searchParams.get('token_hash'))&&link.searchParams.get('type')==='invite','token hash and invite type present');
      check((await issue(email)).body.data?.code==='conflict','normalized duplicate cannot resend');await captured(email,1);
      for(const variant of [email.replace('+tag','+other'),email.replace('+tag','.tag')]){
        stack.ownInvitationEmail(variant);check((await issue(variant)).body.data?.code==='accepted','dot/plus variants remain distinct');
        const row=await stack.readInvitationForEmail(variant);await stack.trackIssuedSubject(row.auth_user_id);
        check(row.auth_user_id!==invitation.auth_user_id&&(await stack.readAuthUser(row.auth_user_id)).email===variant.toLowerCase(),'real provider preserves dot/plus identity');
      }
      diagnosticStage='confirm-initial';const session=emptySession(stack);sessions.push(session);
      for(const options of [{method:'HEAD'},{headers:{'Next-Router-Prefetch':'1'}},{headers:{Purpose:'prefetch'}}]){const noop=await app.request(link.pathname+link.search,{session,...options});privatePolicy(noop);check(noop.status===200&&noop.headers.getSetCookie().length===0,'scanner cannot create cookies or verify Auth');}
      check(!(await stack.readAuthUser(invitation.auth_user_id)).email_confirmed_at,'HEAD/prefetch leaves provider token unused');
      const wrongType=new URL(link);wrongType.searchParams.set('type','signup');
      const rejectedType=await app.request(wrongType.pathname+wrongType.search);privatePolicy(rejectedType);await audit(rejectedType);
      check(rejectedType.status===400&&!(await stack.readAuthUser(invitation.auth_user_id)).email_confirmed_at,'wrong provider type cannot consume acceptance');
      const oldCsrf=await prepareConfirmation(link,session),csrf=await prepareConfirmation(link,session);
      check(!(await stack.readAuthUser(invitation.auth_user_id)).email_confirmed_at,'GET leaves provider token unused');
      check((await postConfirmation(session,csrf,'https://foreign.invalid')).status===403,'foreign origin cannot accept');
      const oldForm=await postConfirmation(session,oldCsrf);check(oldForm.status===400&&!oldForm.headers.getSetCookie().some(v=>v.startsWith('volo-confirmation=')),'old form preserves latest transport cookie');
      check((await postConfirmation(session,csrf)).status===303,'explicit initial acceptance succeeds');await confirmedSetup(session,invitation);
      const replay=emptySession(stack);sessions.push(replay);const replayCsrf=await prepareConfirmation(link,replay);check((await postConfirmation(replay,replayCsrf)).status===400,'provider link replay cannot create authority');
      return 'Actual initial GET/HEAD/prefetch and explicit POST, two-tab CSRF fencing, persisted verified session, separate setup authority, replay denial and no membership.';
    });
    await scenario('invitation_confirmation_late_store_failure',async()=>{
      diagnosticStage='confirm-store-failure';const email=adminQueryEmail.toLowerCase().replace('+tag','+other'),row=await stack.readInvitationForEmail(email);await stack.trackIssuedSubject(row.auth_user_id);
      const link=linkFrom((await captured(email,1))[0]),session=emptySession(stack);sessions.push(session);const csrf=await prepareConfirmation(link,session);
      await app.request('/api/confirmation-failure',{method:'POST',body:'on'});
      try{const failed=await postConfirmation(session,csrf);check(failed.status===503,'late setup persistence failure is unavailable');
        check(!session.cookieHeader().includes('auth-token')&&!session.cookieHeader().includes('volo-setup'),'new Auth/setup cookies cleared after provider verification');
        check((await stack.readInvitationForEmail(email)).status==='issued','failed setup grants no durable snapshot');
        check(Boolean((await stack.readAuthUser(row.auth_user_id)).email_confirmed_at),'provider verification actually preceded store failure');
      }finally{await app.request('/api/confirmation-failure',{method:'POST',body:'off'});}
      return 'Real verifyOtp issued a session before injected local store failure; response clears new session/setup cookies, no membership or setup snapshot.';
    });
    await scenario('invitation_admin_queries',async()=>{
      const email=adminQueryEmail;check(Boolean(email),'owned initial invitation available');
      for(const headers of [{},{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}]){
        const allowed=await page(users.admin,headers,'/admin/invitations');privatePolicy(allowed.response);
        if(!headers['Next-Router-Prefetch']){check(allowed.body.includes(email),'admin receives owned recipient');check(allowed.body.includes('Accepted for sending'),'current actual relation outcome');}
        for(const session of [undefined,users.A]){
          const denied=await page(session,headers,'/admin/invitations');privatePolicy(denied.response);check(!denied.body.includes(email),'recipient absent for unauthorized reader');
          if(!headers['Next-Router-Prefetch'])check(session?denied.body.includes('Access denied'):denied.response.status===307?new URL(denied.response.headers.get('location'),app.origin).href===app.origin+'/login?reason=authentication-required':denied.body.includes('/login?reason=authentication-required'),'explicit denial or fixed login');
        }
      }
      try{
        await stack.setMembership(accounts.admin.id,{role:'admin',status:'disabled'});
        for(const headers of [{},{RSC:'1'}]){const denied=await page(users.admin,headers,'/admin/invitations');privatePolicy(denied.response);check(denied.body.includes('Access denied')&&!denied.body.includes(email),'disabled admin has no invitation data');}
      }finally{await stack.setMembership(accounts.admin.id,{role:'admin',status:'active'});}
      return 'Actual minimal PostgREST relation snapshot with admin/member/anonymous/disabled boundaries and private HTML/RSC responses; no extra email sends.';
    });
    await scenario('invitation_existing_accounts',async()=>{
      const unconfirmed=await stack.createAccount({label:'unconfirmed',role:null,emailConfirmed:false});
      for(const account of [accounts.A,accounts.disabled,unconfirmed]){
        const before=JSON.stringify(await stack.readAuthUser(account.id)),membership=JSON.stringify(await stack.readMembership(account.id));
        const result=await issue(account.email);check(result.body.data?.code==='conflict','existing account rejected');
        check(JSON.stringify(await stack.readAuthUser(account.id))===before,'existing Auth account unchanged');
        check(JSON.stringify(await stack.readMembership(account.id))===membership,'existing membership unchanged');await captured(account.email,0);
      }
      const email=ownedEmail('creation-race');const race=await issue(email,users.admin,app.origin,'/api/invitation-race');
      check(race.body.data?.code==='rejected','duplicate created after reservation rejects');
      const row=await stack.readInvitationForEmail(email),attempts=await stack.readSendAttempts(row.id);
      check(row.auth_user_id===null&&row.status==='pending_issuance'&&attempts[0].outcome==='rejected','competing identity never bound or issued');await captured(email,0);
      return 'Confirmed/unconfirmed/disabled accounts preserved, including a real account created between reservation and createUser.';
    });
    await scenario('invitation_parallel_reservations',async()=>{
      const email=ownedEmail('parallel');const results=await Promise.all([issue(email),issue(email.toUpperCase())]);
      check(results.filter(x=>x.body.data?.code==='accepted').length===1,'one send wins');
      check(results.filter(x=>x.body.data?.code==='conflict').length===1,'duplicate loses without send');
      const row=await stack.readInvitationForEmail(email);check((await stack.readSendAttempts(row.id)).length===1,'one durable attempt');await captured(email,1);
      return 'Concurrent normalized-email requests produce one reservation, subject and captured email.';
    });
    const renew=async(invitation,mode='normal',session=users.admin)=>{
      const response=await read('/api/invitation-renew/'+mode,{session,method:'POST',headers:{'content-type':'application/json',Origin:app.origin},body:JSON.stringify({invitationId:invitation.id,expectedVersion:invitation.version})});
      privatePolicy(response);return {status:response.status,body:await response.json()};
    };
    const setupRenewal=async(label)=>{
      const email=ownedEmail(label);check((await issue(email)).body.data?.code==='accepted','initial accepted');
      const invitation=await stack.readInvitationForEmail(email);await stack.trackIssuedSubject(invitation.auth_user_id);return {email,invitation};
    };
    const acceptCompletionLink=async({email,invitation},link)=>{
      const session=emptySession(stack);sessions.push(session);
      const csrf=await prepareConfirmation(link,session);check((await postConfirmation(session,csrf)).status===303,'owned completion setup verified');
      const form=await app.request('/api/completion-form',{session});privatePolicy(form);const token=(await form.json()).csrf;check(/^[a-f0-9]{64}$/.test(token),'domain separated completion CSRF');
      return {email,invitation,session,csrf:token,password:'OwnedCompletion124!'};
    };
    const completionFixture=async label=>{
      const fixture=await setupRenewal(label);return acceptCompletionLink(fixture,linkFrom((await captured(fixture.email,1))[0]));
    };
    const completionCounts=async()=>await (await app.request('/api/completion-control')).json();
    const completionMode=mode=>app.request('/api/completion-control',{method:'POST',body:mode});
    const postCompletion=async(f,options={})=>{
      invitationPasswords.add(f.password);
      const response=await app.request(options.route??'/account/complete',{session:options.session??f.session,method:options.method??'POST',headers:{Origin:options.origin??app.origin,'content-type':'application/x-www-form-urlencoded'},body:(options.method&&options.method!=='POST')?undefined:options.body??new URLSearchParams({password:f.password,passwordConfirmation:f.password,csrf:options.csrf??f.csrf}).toString()});
      privatePolicy(response);await audit(response);check(response.headers.get('referrer-policy')==='no-referrer','completion referrer suppressed');return response;
    };
    const completionResult=(response,result)=>check(response.status===303&&response.headers.get('location')===app.origin+'/account/setup?result='+result,'fixed completion failure destination '+result);
    await scenario('invitation_setup_ui',async()=>{
      const f=await completionFixture('setup-ui'),counts=await completionCounts();
      const form=await page(f.session,{},'/account/setup'),html=form.body;privatePolicy(form.response);
      check(form.response.status===200&&html.includes('action="/account/complete"'),'verified setup renders native completion form');
      check(html.includes('method="POST"')||html.includes('method="post"'),'native POST');
      check(html.includes('name="password"')&&html.includes('name="passwordConfirmation"')&&html.includes('name="csrf"'),'only completion input contract');
      check(html.includes('autoComplete="new-password"')||html.includes('autocomplete="new-password"'),'password manager hints');
      check(html.includes('value="'+f.csrf+'"'),'existing domain separated CSRF rendered');
      check(!html.includes(f.invitation.id)&&!html.includes(f.invitation.auth_user_id)&&!html.includes(f.password),'no setup identifiers or password rendered');
      check(form.response.headers.get('referrer-policy')==='no-referrer','setup referrer suppressed');
      for(const result of ['invalid_input','password_rejected','retry_later','renew_invitation','access_denied']){
        const error=await page(f.session,{},'/account/setup?result='+result);privatePolicy(error.response);check(error.body.includes('role="alert"'),'recognized failure accessible');
      }
      const ordinary=await page(users.absent,{},'/account/setup');check(!ordinary.body.includes('name="password"')&&ordinary.body.includes('Invitation required'),'ordinary Auth session does not authorize setup');
      const anonymous=await page(undefined,{},'/account/setup');check(anonymous.response.status===307&&anonymous.response.headers.get('location')==='/login?reason=authentication-required','signed-out setup goes to fixed login');
      for(const headers of [{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}]){const navigation=await page(f.session,headers,'/account/setup');privatePolicy(navigation.response);if(!headers['Next-Router-Prefetch'])check(navigation.response.status===200&&navigation.body.includes(f.csrf),'verified RSC passes only authorized form props');}
      const forged=await page(users.absent,{},'/account/setup?result=completed&next=https://foreign.invalid&password=canary-query-password');privatePolicy(forged.response);
      check(!forged.body.includes('name="password"'),'generic session/query never authorize form');check(!forged.body.includes('canary-query-password'),`query password must not echo (HTTP ${forged.response.status})`);check(!forged.body.includes('foreign.invalid'),'query destination must not echo');
      const duplicate=await page(f.session,{},'/account/setup?result=retry_later&result=access_denied');check(!duplicate.body.includes('role="alert"'),'ambiguous result ignored');
      completionResult(await postCompletion(f,{body:new URLSearchParams({password:f.password,passwordConfirmation:'different-password',csrf:f.csrf}).toString()}),'invalid_input');
      const retried=await page(f.session,{},'/account/setup?result=invalid_input');check(retried.body.includes('name="password"')&&!retried.body.includes(f.password),'retry form keeps authority without password echo');
      check((await completionCounts()).writes===counts.writes,'GET/query/invalid form perform no password mutation');
      const done=await postCompletion(f);check(done.headers.get('location')===app.origin+'/dashboard','native setup contract completes');
      const back=await page(f.session,{},'/account/setup');check(back.response.status===307&&back.response.headers.get('location')==='/dashboard?from=account-setup','refresh/back rechecks current membership and leaves setup without login loop');
      const stale=await completionFixture('setup-ui-revoked');await stack.revokeInvitation(stale.invitation.id,accounts.admin.id);
      const denied=await page(stale.session,{},'/account/setup');check(!denied.body.includes('name="password"'),'revoked authority does not render password form');
      return 'Actual setup page checks bound authority, native form/CSRF contract, safe accessible errors, rejected mismatch, current-member back navigation and revoked authority denial.';
    });
    await scenario('invitation_completion_native',async()=>{
      const f=await completionFixture('completion-success'),initialCounts=await completionCounts(),before=initialCounts.writes;
      const retained=f.session.clone();sessions.push(retained);
      check((await postCompletion(f,{origin:'https://foreign.invalid'})).status===403,'foreign completion Origin denied');
      completionResult(await postCompletion(f,{csrf:'d'.repeat(64)}),'invalid_input');
      const missing=emptySession(stack);sessions.push(missing);completionResult(await postCompletion(f,{session:missing}),'invalid_input');
      check((await postCompletion(f,{method:'GET'})).status===405,'GET completion cannot mutate');
      completionResult(await postCompletion(f,{route:'/account/complete?next=https://foreign.invalid'}),'invalid_input');
      completionResult(await postCompletion(f,{body:new URLSearchParams({password:f.password,passwordConfirmation:'different-password',csrf:f.csrf}).toString()}),'invalid_input');
      check((await completionCounts()).authReads===initialCounts.authReads,'Origin/CSRF/input/method checks run before any Auth reads or refresh');
      check((await completionCounts()).writes===before,'invalid completion never changes password');
      const policy=await app.request('/api/completion-policy',{session:f.session,method:'POST'});check((await policy.json()).code==='rejected','pinned Auth weak password definitely rejected');check((await completionCounts()).providerCode==='weak_password','real weak_password provider code characterized');
      const count=(await completionCounts()).writes,done=await postCompletion(f);check(done.status===303&&done.headers.get('location')===app.origin+'/dashboard','successful completion redirects to dashboard');
      check(!f.session.cookieHeader().includes('volo-setup='),'success clears only setup cookie');
      check(f.session.cookieHeader().includes('auth-token'),'success retains Auth session');
      check((await stack.readMembership(f.invitation.auth_user_id))?.role==='member','existing redemption creates member');
      const login=await signInSession(stack,{id:f.invitation.auth_user_id,email:f.email,password:f.password});sessions.push(login);check(login.userId===f.invitation.auth_user_id,'new password logs in same subject');
      const history=retained.clone();sessions.push(history);const replay=await postCompletion(f,{session:history});check(replay.status===303&&replay.headers.get('location')===app.origin+'/dashboard','historical retry completes through fresh access');
      check((await completionCounts()).writes===count+1,'historical retry does not repeat password');
      await stack.setMembership(f.invitation.auth_user_id,{role:'member',status:'disabled'});completionResult(await postCompletion(f,{session:retained}),'access_denied');check((await completionCounts()).writes===count+1,'disabled historical retry does not change password');check((await stack.readMembership(f.invitation.auth_user_id)).status==='disabled','retry preserves disabled membership');
      return 'Production completion route: private native POST, Origin/CSRF/input/method denial, real weak_password rejection, same-subject password login, one member, history skips Auth and disabled membership stays denied.';
    });
    await scenario('invitation_completion_failure_recovery',async()=>{
      for(const mode of ['password-lost','record-lost','record-failure','redeem-lost']){
        const f=await completionFixture('completion-'+mode),count=(await completionCounts()).writes;
        await completionMode(mode);let response;try{response=await postCompletion(f);}finally{await completionMode('off');}
        check((await completionCounts()).writes===count+1,'failure mode makes exactly one real password PUT');
        if(mode==='password-lost'){
          completionResult(response,'renew_invitation');completionResult(await postCompletion(f),'retry_later');check((await completionCounts()).writes===count+1,'unknown password response keeps reservation');check(await stack.readMembership(f.invitation.auth_user_id)===null,'unknown password grants no membership');
        }else if(mode==='record-failure'){
          completionResult(response,'retry_later');completionResult(await postCompletion(f),'password_rejected');check((await completionCounts()).providerCode==='same_password','real same_password provider rejection characterized');check(await stack.readMembership(f.invitation.auth_user_id)===null,'rejected same password grants no membership');
          f.password='OwnedCompletion124Changed!';check((await postCompletion(f)).headers.get('location')===app.origin+'/dashboard','safe release allows corrected password');
        }else if(mode==='redeem-lost'){
          completionResult(response,'retry_later');check((await postCompletion(f)).headers.get('location')===app.origin+'/dashboard','lost redemption response resumes history');check((await completionCounts()).writes===count+1,'lost redemption retry skips password');
        }else check(response.headers.get('location')===app.origin+'/dashboard','lost record response reconciles committed evidence');
      }
      return 'Real owned password PUT response loss denies without replay; committed evidence reconciles; failed recording safely releases; same_password classified; lost redemption response resumes without another password PUT.';
    });
    await scenario('invitation_setup_binding_denials',async()=>{
      const f=await completionFixture('binding'),count=(await completionCounts()).writes;
      const foreign=users.absent.withSetupFrom(f.session);sessions.push(foreign);
      const alternate=(await signInOwnedInvitationSession(stack,f.invitation.auth_user_id)).withSetupFrom(f.session);sessions.push(alternate);
      for(const session of [foreign,alternate]){
        const response=await app.request('/api/confirmation-session',{session});privatePolicy(response);await audit(response,session.userId);
        const data=await response.json();check(data.session.code==='verified'&&data.setup.status==='denied','real verified identity/session cannot borrow setup');
        completionResult(await postCompletion(f,{session}),'access_denied');
      }
      check((await completionCounts()).writes===count&&await stack.readMembership(f.invitation.auth_user_id)===null,'borrowed setup never changes password or admits');
      await confirmedSetup(f.session,f.invitation);
      const cases=['revoked','superseded','renewed','plus-email','dot-email'];
      for(const mode of cases){
        const invalid=await completionFixture('binding-'+mode),before=(await completionCounts()).writes;
        if(mode==='revoked')await stack.revokeInvitation(invalid.invitation.id,accounts.admin.id);
        else if(mode==='superseded'){
          const replacement=await setupRenewal('replacement');await stack.setInvitationTestState(invalid.invitation.id,mode,replacement.invitation.id);
        }else if(mode==='renewed'){
          check((await renew(invalid.invitation)).body.data?.code==='accepted','renewal creates new generation');
          check((await stack.readInvitationForEmail(invalid.email)).version===2,'old setup version fenced');
        }else{
          const email=mode==='plus-email'?invalid.email.replace('@','+tag@'):invalid.email.replace('-','.');
          stack.ownInvitationEmail(email);await stack.setOwnedAuthEmail(invalid.invitation.auth_user_id,email);
          check((await stack.readAuthUser(invalid.invitation.auth_user_id)).email===email,'real provider changed owned email');
        }
        const denied=await app.request('/api/confirmation-session',{session:invalid.session});privatePolicy(denied);await audit(denied,invalid.invitation.auth_user_id);
        const verified=await denied.json();
        check(verified.session.code==='verified'&&verified.session.subject===invalid.invitation.auth_user_id&&verified.setup.status==='denied','valid provider session cannot bypass invitation/email/version denial');
        completionResult(await postCompletion(invalid),'access_denied');
        check((await completionCounts()).writes===before&&await stack.readMembership(invalid.invitation.auth_user_id)===null,'denial precedes password and membership writes');
      }
      return 'Real verified wrong-subject and new same-subject session with copied setup cookies denied; revoked/superseded/renewed grants and changed dot/plus recipient emails denied before password writes.';
    });
    await scenario('invitation_age_and_independent_expiry',async()=>{
      const fixture=await setupRenewal('old-expiry');await stack.setInvitationTestState(fixture.invitation.id,'old');
      const original=linkFrom((await captured(fixture.email,1))[0]);await stack.setInvitationTestState(fixture.invitation.id,'expired-provider');
      const expired=emptySession(stack);sessions.push(expired);const csrf=await prepareConfirmation(original,expired);
      check((await postConfirmation(expired,csrf)).status===400,'real provider rejects expired invitation link');
      check(await stack.readMembership(fixture.invitation.auth_user_id)===null&&(await stack.readInvitationForEmail(fixture.email)).status==='issued','provider expiry leaves old invitation eligible');
      check((await renew(fixture.invitation)).body.data?.code==='accepted','old invitation can renew expired provider link');
      let row=await stack.readInvitationForEmail(fixture.email);check(row.auth_user_id===fixture.invitation.auth_user_id&&row.created_at.startsWith('2000-01-01'),'renewal preserves old invitation and subject');
      let f=await acceptCompletionLink({email:fixture.email,invitation:row},linkFrom((await captured(fixture.email,2)).find(html=>linkFrom(html).searchParams.has('resume'))));
      await confirmedSetup(f.session,row);await stack.assertSetupLifetime(row.id);
      const before=(await completionCounts()).writes;await stack.setInvitationTestState(row.id,'expired-setup');
      const denied=await app.request('/api/confirmation-session',{session:f.session});privatePolicy(denied);await audit(denied,row.auth_user_id);
      const verified=await denied.json();check(verified.session.code==='verified'&&verified.setup.status==='denied','setup expires independently of valid provider session');completionResult(await postCompletion(f),'access_denied');
      check((await completionCounts()).writes===before&&await stack.readMembership(row.auth_user_id)===null,'expired setup never changes password or admits');
      await delay(1100);check((await renew(row)).body.data?.code==='accepted','expired setup can renew verification without expiring invitation');
      row=await stack.readInvitationForEmail(fixture.email);
      f=await acceptCompletionLink({email:fixture.email,invitation:row},linkFrom((await captured(fixture.email,3)).find(html=>linkFrom(html).searchParams.get('type')==='recovery')));
      check((await postCompletion(f)).headers.get('location')===app.origin+'/dashboard','renewed old invitation completes');
      const admitted=await read('/api/subject',{session:f.session});privatePolicy(admitted);const member=await admitted.json();
      check(admitted.status===200&&member.userId===row.auth_user_id&&member.role==='member','fresh protected request admits same old invitation subject');
      return 'Backdated real provider token rejected; year-2000 invitation stays eligible through invite/recovery renewal; separate 30-minute setup expires before password writes and fresh verification completes same member.';
    });
    await scenario('invitation_completion_concurrency',async()=>{
      const f=await completionFixture('completion-race'),before=(await completionCounts()).writes;
      const requests=[f.session.clone(),f.session.clone()];sessions.push(...requests);
      const results=await Promise.all(requests.map(session=>postCompletion(f,{session})));
      check(results.some(response=>response.headers.get('location')===app.origin+'/dashboard'),'one concurrent completion succeeds');
      for(const response of results)check([app.origin+'/dashboard',app.origin+'/account/setup?result=retry_later'].includes(response.headers.get('location')),'other completion resumes safely or reports busy');
      check((await completionCounts()).writes===before+1,'concurrent completion makes one real provider password PUT');
      const row=await stack.readInvitationForEmail(f.email),member=await stack.readMembership(row.auth_user_id);
      check(row.status==='redeemed'&&member.role==='member'&&member.status==='active','one atomic member redemption');
      for(const session of requests){
        const response=await read('/api/subject',{session});privatePolicy(response);check(response.status===200&&(await response.json()).userId===row.auth_user_id,'fresh concurrent session sees same member');
      }
      check((await postCompletion(f)).headers.get('location')===app.origin+'/dashboard'&&(await completionCounts()).writes===before+1,'historical duplicate skips another password change');
      return 'Two independent native requests produce one password PUT, one redeemed invitation/member and fresh same-subject access; duplicate completion is idempotent.';
    });
    await scenario('invitation_renewal_real_transports',async()=>{
      diagnosticStage='renew-unconfirmed';const {email,invitation}=await setupRenewal('renewal');
      const form=(await app.invitationForms(users.admin)).find(form=>form.kind==='renew'&&form.fields.some(([key,value])=>key==='invitationId'&&value===invitation.id));check(Boolean(form),'actual renewal form exists');
      for(const session of [undefined,users.A,users.disabled]){
        const denied=await app.invitationAction(form,{session});privatePolicy(denied);await audit(denied,session===users.A?accounts.A.id:session===users.disabled?accounts.disabled.id:undefined);
        check((await stack.readInvitationForEmail(email)).version===1,'forged UI action cannot renew');await captured(email,1);
      }
      const foreign=await app.invitationAction(form,{session:users.admin,origin:'https://foreign.invalid'});await audit(foreign,accounts.admin.id);check((await stack.readInvitationForEmail(email)).version===1,'foreign origin cannot renew');await captured(email,1);
      const sent=await app.invitationAction(form,{session:users.admin,transport:'fetched'});privatePolicy(sent);await audit(sent,accounts.admin.id);check((await sent.text()).includes('Accepted for sending'),'actual fetched UI renewal accepted');
      const stale=await app.invitationAction(form,{session:users.admin});privatePolicy(stale);await audit(stale,accounts.admin.id);check((await stale.text()).includes('invitation changed'),'stale UI retry explains conflict');await captured(email,2);
      let row=await stack.readInvitationForEmail(email);check(row.version===2&&row.auth_user_id===invitation.auth_user_id&&row.invited_by_user_id===invitation.invited_by_user_id,'same subject and inviter, next version');
      const messages=await captured(email,2);const html=messages.find(m=>linkFrom(m).searchParams.has('resume'));check(Boolean(html),'resend proof retained');
      let link=linkFrom(html);check(link.searchParams.get('type')==='invite','unconfirmed invitation transport');
      const oldLink=linkFrom(messages.find(m=>!linkFrom(m).searchParams.has('resume'))),oldSession=emptySession(stack);sessions.push(oldSession);const oldCsrf=await prepareConfirmation(oldLink,oldSession);check((await postConfirmation(oldSession,oldCsrf)).status===400,'original initial provider link cannot authorize a renewed generation');
      let attempt=(await stack.readSendAttempts(row.id)).find(a=>a.invitation_version===2);const proof=await stack.readSendProof(attempt.id);check(proof?.transport==='invite'&&!proof.consumed_at,'proof persisted before send');
      diagnosticStage='verify-owned-invite';const inviteSession=emptySession(stack);sessions.push(inviteSession);const inviteCsrf=await prepareConfirmation(link,inviteSession);
      const races=await Promise.all([postConfirmation(inviteSession,inviteCsrf),postConfirmation(inviteSession.clone(),inviteCsrf)]);check(races.filter(r=>r.status===303).length===1,'one concurrent explicit accept succeeds');
      // Apply the winning response to the owned browser after both race responses.
      inviteSession.applyResponse(races.find(r=>r.status===303));await confirmedSetup(inviteSession,row);
      check(Boolean((await stack.readSendProof(attempt.id)).consumed_at),'invite proof consumed atomically with setup');
      let verified={subjectId:row.auth_user_id,resume:link.searchParams.get('resume'),type:'invite'};
      const consume=()=>stack.consumeSendProof(attempt.id,row.version,verified.subjectId,verified.resume,verified.type);
      await stack.checkpointAuth(row.auth_user_id);await delay(1100);
      diagnosticStage='renew-confirmed';check((await renew(row)).body.data?.code==='accepted','confirmed recovery resend accepted');
      await stack.checkpointAuth(row.auth_user_id,true);row=await stack.readInvitationForEmail(email);check(row.version===3&&row.auth_user_id===invitation.auth_user_id,'confirmed resend retains subject');
      const recovery=(await captured(email,3)).find(m=>linkFrom(m).searchParams.get('type')==='recovery');check(Boolean(recovery),'dedicated recovery captured');
      link=linkFrom(recovery);check(Boolean(link.searchParams.get('resume')),'recovery callback retains proof');
      const ordinary=new URL(link);ordinary.searchParams.delete('resume');check((await app.request(ordinary.pathname+ordinary.search)).status===400,'ordinary recovery without invitation proof never reaches provider verification');
      attempt=(await stack.readSendAttempts(row.id)).find(a=>a.invitation_version===3);verified={subjectId:row.auth_user_id,resume:link.searchParams.get('resume'),type:'recovery'};
      check((await stack.consumeSendProof(attempt.id,row.version,verified.subjectId,verified.resume,'invite')).code==='conflict','wrong transport fails');
      check((await stack.consumeSendProof(attempt.id,row.version,verified.subjectId,'','recovery')).code==='conflict','ordinary recovery without proof denied');
      const recoverySession=emptySession(stack);sessions.push(recoverySession);const recoveryCsrf=await prepareConfirmation(link,recoverySession);check((await postConfirmation(recoverySession,recoveryCsrf)).status===303,'proof-bearing recovery accepts explicitly');await confirmedSetup(recoverySession,row);
      check(Boolean((await stack.readSendProof(attempt.id)).consumed_at),'recovery proof consumed atomically');
      await delay(1100);const overlap=await Promise.all([consume(),renew(row)]);
      check(['conflict','stale'].includes(overlap[0].code)&&overlap[1].body.data?.code==='accepted','proof consumption and renewal serialize');
      check((await consume()).code==='stale','renewal fences previous generation');check(await stack.readSendProof(attempt.id)===null,'old proof removed');row=await stack.readInvitationForEmail(email);
      const currentAttempt=(await stack.readSendAttempts(row.id)).find(a=>a.invitation_version===4);check(!(await stack.readSendProof(currentAttempt.id)).consumed_at,'old consumer cannot consume new proof');
      await stack.revokeInvitation(row.id,accounts.admin.id);check((await renew(row)).body.data?.code==='conflict','terminal renewal denied');await captured(email,4);
      check(await stack.readMembership(row.auth_user_id)===null,'renewals grant no membership');
      return 'Real invite and recovery tokens verified against the same owned subject; single-use and stale proof fences; SQL asserts unchanged password hash, confirmation, ban and role during recovery send.';
    });
    await scenario('invitation_renewal_concurrency_and_authorization',async()=>{
      const {email,invitation}=await setupRenewal('renew-race');
      for(const session of [null,users.A,users.disabled])check([401,403].includes((await renew(invitation,'normal',session)).status),'non-admin renewal denied');
      const outcomes=await Promise.all([renew(invitation),renew(invitation)]);check(outcomes.filter(r=>r.body.data?.code==='accepted').length===1,'one concurrent send');
      check(outcomes.filter(r=>r.body.data?.code==='conflict').length===1,'one stale loser');
      const row=await stack.readInvitationForEmail(email);check(row.version===2&&(await stack.readSendAttempts(row.id)).length===2,'one new attempt');await captured(email,2);
    });
    await scenario('invitation_renewal_uncertainty',async()=>{
      for(const mode of ['lost-response','lost-record']){
        const {email,invitation}=await setupRenewal(mode);check((await renew(invitation,mode)).body.data?.code==='pending_reconciliation','uncertainty fails closed');
        const row=await stack.readInvitationForEmail(email);await captured(email,2);check(row.status==='pending_issuance','uncertainty never issues');
        check((await renew(row)).body.data?.code==='pending_reconciliation','unresolved generation blocks another send');await captured(email,2);
        const inspectForm=(await app.invitationForms(users.admin)).find(form=>form.kind==='inspect'&&form.fields.some(([key,value])=>key==='invitationId'&&value===row.id));check(Boolean(inspectForm),'uncertain row offers status check');
        const checked=await app.invitationAction(inspectForm,{session:users.admin});privatePolicy(checked);await audit(checked,accounts.admin.id);check((await checked.text()).includes('Needs review'),'UI inspection does not infer receipt from Auth state');await captured(email,2);
        if(mode==='lost-record'){
          check((await renew(row,'reconcile')).body.data?.code==='accepted','original trusted provider response resolves');
          const resolved=await stack.readInvitationForEmail(email),attempt=(await stack.readSendAttempts(row.id)).find(a=>a.invitation_version===2);
          check(resolved.status==='issued'&&attempt.outcome==='started'&&attempt.reconciled_outcome==='accepted','separate resolution preserves original outcome');await captured(email,2);
        }
      }
      return 'Lost response remains unresolved; lost recording reconciles only from the in-process original response, without another email.';
    });
    if(!process.argv.includes('--scenario')){
      await scenario('current_membership',async()=>{
        users.A=await fresh('A');
        const retained=users.A.cookieHeader();await stack.setMembership(accounts.A.id,{role:'member',status:'disabled'});
        check((await read('/api/subject',{session:users.A})).status===403,'disabled current row');check(users.A.cookieHeader()===retained,'unchanged credentials');for(const transport of ['json','native','fetched'])await deny(transport,users.A);
        await stack.setMembership(accounts.A.id,{role:'member',status:'active'});check((await read('/api/subject',{session:users.A})).status===200,'reactivated membership');await success('json',users.A);
      });
      await scenario('role_downgrade',async()=>{
        users.admin=await fresh('admin');
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
          for(const headers of [{Accept:'text/html'},{RSC:'1'},{RSC:'1','Next-Router-Prefetch':'1'}]){const {response,body}=await page(session,headers);privatePolicy(response);if(session&&!headers['Next-Router-Prefetch'])check(body.includes(accounts[label].id),`${headers.RSC?'own navigation RSC subject':'own HTML subject'} (HTTP ${response.status}; session ${session.expiresAt*1000>Date.now()?'unexpired':'expired'}; login ${body.includes('/login?reason=authentication-required')}; unavailable ${body.includes('unavailable')})`);if(!session)check(!/subject:/.test(body),'anonymous private content');}
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
        const completion=await completionFixture('expired-completion'),completionCookies=completion.session.cookieHeader();
        const started=Date.now(),valid=await fresh('A'),independent=await fresh('B'),terminated=await fresh('B'),invalid=terminated.clone();sessions.push(invalid);await terminated.signOut();
        const concurrent=[valid,valid.clone(),valid.clone()];sessions.push(...concurrent.slice(1));
        const before=valid.cookieHeader(),wait=Math.max(valid.expiresAt,independent.expiresAt,invalid.expiresAt,completion.session.expiresAt)*1000+2000-Date.now();check(wait>0&&wait<=180000,'bounded real expiry');
        // Short waits allow a cancellation signal to reach owned cleanup promptly.
        let remaining=wait;while(remaining>0){const step=Math.min(remaining,1000);await delay(step,undefined,{signal:cancellation.signal});remaining-=step;}
        await Promise.all([...concurrent.map(session=>({session,id:accounts.A.id})),{session:independent,id:accounts.B.id}].map(async({session,id})=>{
          const response=await read('/api/subject',{session,expectedUserId:id});privatePolicy(response);check(response.status===200,'concurrent expired refresh recovered');check((await response.json()).userId===id,'immutable refresh subject');
          check(response.headers.getSetCookie().length>0&&session.cookieHeader()!==before,'Proxy persisted rotated cookies');
          const next=await read('/api/subject',{session,expectedUserId:id});check(next.status===200&&(await next.json()).userId===id,'next request identity from returned cookies');
        }));
        const completed=await postCompletion(completion);check(completed.headers.get('location')===app.origin+'/dashboard','expired completion session refreshes through writable handler');
        check(completed.headers.getSetCookie().some(v=>v.includes('auth-token'))&&completion.session.cookieHeader()!==completionCookies,'completion persists refreshed Auth cookies');
        const admitted=await app.request('/api/subject',{session:completion.session});check(admitted.status===200&&(await admitted.json()).userId===completion.invitation.auth_user_id,'next request admits same completion subject from returned cookies');
        const bad=await read('/api/subject',{session:invalid});privatePolicy(bad);if(bad.status!==401){const observed=await invalid.probeRetainedCredentials();check(false,`expired invalid refresh denied (HTTP ${bad.status}; real refresh ${observed.refreshStatus??0}/${observed.refreshCode??observed.refresh})`);}await deny('json',invalid);check(Date.now()-started<=240000,'expiry scenario deadline');
        return {accessLifetimeSeconds:120,waitBoundSeconds:180,scenarioBoundSeconds:240};
      });
      await scenario('credential_leaks',async()=>{await app.scanStatic(assertClean);assertClean(app.diagnostics());});
    }
  }
}catch(error){
  if(stack)summary.authFailureCategory=await stack.authFailureCategory();
  if(error.fixtureDiagnostic)summary.fixtureDiagnostic=error.fixtureDiagnostic;
  if(error.operation)summary.setupOperation={operation:error.operation,status:error.httpStatus??'transport',...(error.authCode?{code:error.authCode}:{})};
  console.error(`Setup stage: ${setupStage}`);
  const missingDocker=error.message==='Real local Auth stack requires a running Docker engine; no simulated fallback';
  console.error(error.message.startsWith('Integration scenario failed:')||missingDocker?error.message:'Real Auth integration failed during setup or cleanup; no credentials logged');process.exitCode=1;
  if(!summary.scenarios.some(x=>x.status==='failed'))summary.scenarios.push({name:'setup',status:'failed',evidence:missingDocker?'Docker unavailable':`Service/fixture setup failed (${['configuration','start','status','credentials'].includes(error.setupStage)?error.setupStage:setupStage}); raw output withheld`});
}
finally{
  try{await app?.close();}catch{process.exitCode=1;summary.scenarios.push({name:'fixture_cleanup',status:'failed'});}
  try{await stack?.close();}catch(error){process.exitCode=1;summary.scenarios.push({name:'stack_cleanup',status:'failed',evidence:error.cleanupStage??'unknown',...(error.cleanupDiagnostic?{diagnostic:error.cleanupDiagnostic}:{})});}
  process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);
  if(!process.argv.includes('--cleanup')){await mkdir(evidenceDirectory(root),{recursive:true});await writeFile(path.join(evidenceDirectory(root),'summary.json'),JSON.stringify(summary,null,2)+'\n');}
}
