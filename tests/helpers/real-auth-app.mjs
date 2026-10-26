import {randomBytes} from 'node:crypto';
import {execFile,spawn} from 'node:child_process';
import {once} from 'node:events';
import {cp,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {reservePort,validateLocalApiUrl,sanitizeDiagnostics,evidenceDirectory} from './local-auth-stack.mjs';

const decode=value=>value.replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&amp;','&');
export async function startRealAuthApp({repositoryRoot:root,stack,signal,applicationOrigin,browser=false,photos=false,flights=false,interest=false,memberAdmin=false}) {
  validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
  const directory=await mkdtemp(path.join(tmpdir(),'volo-real-auth-app-'));const effects=[];let server,recorder,output='',closePromise,fixtureStage='files';
  const put=async(name,value)=>{const file=path.join(directory,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,value);};
  const close=()=>closePromise??=(async()=>{
    if(server&&server.exitCode===null){server.kill();await Promise.race([once(server,'exit'),delay(5000).then(()=>{if(server.exitCode===null)server.kill('SIGKILL');})]);}
    if(recorder?.listening){recorder.closeAllConnections();await new Promise(resolve=>recorder.close(resolve));}
    await rm(directory,{recursive:true,force:true});
  })();
  try {
    signal?.throwIfAborted();
    recorder=createServer(async(req,res)=>{try{let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)throw new Error();}const data=JSON.parse(body);if(!/^[a-f0-9-]{36}$/i.test(data.userId))throw new Error();effects.push({userId:data.userId});res.end('{}');}catch{res.statusCode=400;res.end();}});
    recorder.listen(0,'127.0.0.1');await once(recorder,'listening');const recordOrigin=`http://127.0.0.1:${recorder.address().port}`;
    const port=applicationOrigin?Number(new URL(applicationOrigin).port):await reservePort(),origin=`http://127.0.0.1:${port}`;
    if(applicationOrigin&&origin!==applicationOrigin)throw new Error('Invalid owned application origin');
    const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:stack.apiUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:stack.publicKey,VOLO_MUTATION_ORIGIN:origin,SUPABASE_SECRET_KEY:stack.serverSecret,VOLO_CONFIRMATION_KEYS:JSON.stringify({active:'fixture',keys:{fixture:randomBytes(32).toString('base64')}})};
    await symlink(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
    for(const name of ['lib','proxy.ts','tsconfig.json','next.config.ts'])await cp(path.join(root,name),path.join(directory,name),{recursive:true});
    await cp(path.join(root,'app/account'),path.join(directory,'app/account'),{recursive:true});
    await cp(path.join(root,'app/auth'),path.join(directory,'app/auth'),{recursive:true});
    await cp(path.join(root,'app/login'),path.join(directory,'app/login'),{recursive:true});
    await cp(path.join(root,'app/forgot-password'),path.join(directory,'app/forgot-password'),{recursive:true});
    await cp(path.join(root,'app/reset-password'),path.join(directory,'app/reset-password'),{recursive:true});
    await cp(path.join(root,'app/(protected)/layout.tsx'),path.join(directory,'protected-layout.tsx'));
    await cp(path.join(root,'app/(protected)/admin'),path.join(directory,'app/(protected)/admin'),{recursive:true});
    await cp(path.join(root,'app/(protected)/_components'),path.join(directory,'app/(protected)/_components'),{recursive:true});
    await cp(path.join(root,'app/(protected)/layout.tsx'),path.join(directory,'app/(protected)/layout.tsx'));
    if(photos){
      await cp(path.join(root,'app/api/profile/photo'),path.join(directory,'app/api/profile/photo'),{recursive:true});
      await cp(path.join(root,'app/api/profiles'),path.join(directory,'app/api/profiles'),{recursive:true});
      await cp(path.join(root,'app/(protected)/profile'),path.join(directory,'app/(protected)/profile'),{recursive:true});
    }
    await put('package.json',JSON.stringify({private:true,type:'module'}));
    await put('instrumentation.js',`export function register(){const original=globalThis.fetch;globalThis.fetch=async(input,init)=>{
      const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
      if(!${JSON.stringify([stack.apiUrl,recordOrigin])}.includes(url.origin)||url.username||url.password)throw new Error('Fixture forbids outbound requests');
      if(globalThis.__voloPhotoMode==='delete-failure'&&url.pathname.startsWith('/storage/v1/object/')&&init?.method==='DELETE')return Response.json({error:'fixture_unavailable'},{status:503});
      if(globalThis.__voloPhotoMode==='upload-failure'&&url.pathname.startsWith('/storage/v1/object/profile-photos/')&&init?.method==='POST')return Response.json({error:'fixture_unavailable'},{status:503});
      if(url.pathname==='/auth/v1/recover'){
        globalThis.__voloRecoveryCalls=(globalThis.__voloRecoveryCalls??0)+1;
        if(globalThis.__voloRecoveryMode==='outage')return Response.json({code:'fixture_unavailable'},{status:503});
        if(globalThis.__voloRecoveryMode==='rate-limit')return Response.json({code:'over_email_send_rate_limit'},{status:429});
        if(globalThis.__voloRecoveryMode==='malformed')return new Response('invalid-json',{status:200});
      }
      if(url.pathname==='/auth/v1/logout'){
        globalThis.__voloLogoutCalls=(globalThis.__voloLogoutCalls??0)+1;
        if(globalThis.__voloLogoutMode==='outage')return Response.json({code:'fixture_unavailable'},{status:503});
      }
      if(url.pathname==='/auth/v1/token'&&url.searchParams.get('grant_type')==='password'){
        globalThis.__voloLoginCalls=(globalThis.__voloLoginCalls??0)+1;
        if(globalThis.__voloLoginMode==='outage')return Response.json({code:'fixture_unavailable'},{status:503});
        if(globalThis.__voloLoginMode==='malformed')return Response.json({user:{id:'invalid'}},{status:200});
      }
      if(url.pathname==='/rest/v1/flights'&&(!init?.method||init.method==='GET')){
        globalThis.__voloFlightFeedCalls=(globalThis.__voloFlightFeedCalls??0)+1;
        if(globalThis.__voloFlightFeedMode==='delay')await new Promise(resolve=>setTimeout(resolve,1500));
        if(globalThis.__voloFlightFeedMode==='outage')return Response.json({code:'private-feed-error-canary'},{status:503});
        if(globalThis.__voloFlightFeedMode?.startsWith('disable-after-read:')){
          const response=await original(input,{...init,redirect:'error'}),body=await response.text();
          const subject=globalThis.__voloFlightFeedMode.slice(19);
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/memberships?user_id=eq.')}+subject,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned feed race'})});
          if(!changed.ok)throw new Error('Owned feed race rejected');
          return new Response(body,{status:response.status,headers:response.headers});
        }
      }
      if(globalThis.__voloFailSetup&&url.pathname==='/rest/v1/rpc/record_verified_invitation_setup')return Response.json({code:'fixture_store_unavailable'},{status:503});
      if((url.pathname==='/auth/v1/user'&&init?.method!=='PUT')||url.pathname==='/auth/v1/token')globalThis.__voloCompletionAuthReads=(globalThis.__voloCompletionAuthReads??0)+1;
      const password=url.pathname==='/auth/v1/user'&&init?.method==='PUT';
      if(password)globalThis.__voloPasswordWrites=(globalThis.__voloPasswordWrites??0)+1;
      const mode=globalThis.__voloCompletionMode;
      if(mode==='record-failure'&&url.pathname==='/rest/v1/rpc/record_invitation_password')return Response.json({code:'fixture_unavailable'},{status:503});
      if(['/rest/v1/rpc/create_flight','/rest/v1/rpc/create_private_flight'].includes(url.pathname)){
        globalThis.__voloFlightCreateCalls=(globalThis.__voloFlightCreateCalls??0)+1;
        if(globalThis.__voloFlightCreateMode?.startsWith('disable:')){
          const subject=globalThis.__voloFlightCreateMode.slice(8);
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/memberships?user_id=eq.')}+subject,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned creation race'})});
          if(!changed.ok)throw new Error('Owned eligibility race setup rejected');
        }
      }
      if(url.pathname==='/rest/v1/flight_requests'&&(!init?.method||init.method==='GET')&&globalThis.__voloInterestMode==='read-outage')return Response.json({code:'private-interest-error-canary'},{status:503});
      if(url.pathname==='/rest/v1/rpc/get_network_profile'&&globalThis.__voloInterestMode?.startsWith('profile-timeout:')&&String(init?.body??'').includes(globalThis.__voloInterestMode.slice('profile-timeout:'.length)))await new Promise(resolve=>setTimeout(resolve,5500));
      if(url.pathname==='/rest/v1/rpc/submit_flight_interest'){
        globalThis.__voloInterestCalls=(globalThis.__voloInterestCalls??0)+1;
        const mode=globalThis.__voloInterestMode;
        if(mode?.startsWith('disable:')||mode?.startsWith('full:')){
          const disable=mode.startsWith('disable:'),id=mode.slice(disable?8:5);
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/')}+(disable?'memberships?user_id=eq.':'flight_requests?id=eq.')+id,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify(disable?{status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned interest race'}:{status:'accepted'})});
          if(!changed.ok)throw new Error('Owned interest race setup rejected');
        }
      }
      if(url.pathname==='/rest/v1/rpc/decide_flight_request'){
        globalThis.__voloDecisionCalls=(globalThis.__voloDecisionCalls??0)+1;
        const mode=globalThis.__voloDecisionMode;
        if(mode?.startsWith('disable:')){
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/memberships?user_id=eq.')}+mode.slice(8),{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned decision race'})});
          if(!changed.ok)throw new Error('Owned decision eligibility setup rejected');
        }
      }
      if(url.pathname==='/rest/v1/rpc/withdraw_flight_request'){
        globalThis.__voloWithdrawalCalls=(globalThis.__voloWithdrawalCalls??0)+1;
        if(globalThis.__voloWithdrawalMode?.startsWith('disable:')){
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/memberships?user_id=eq.')}+globalThis.__voloWithdrawalMode.slice(8),{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned withdrawal race'})});
          if(!changed.ok)throw new Error('Owned withdrawal eligibility setup rejected');
        }
      }
      if(url.pathname==='/rest/v1/rpc/cancel_flight'){
        globalThis.__voloCancellationCalls=(globalThis.__voloCancellationCalls??0)+1;
      }
      if(url.pathname==='/rest/v1/rpc/edit_flight'){
        globalThis.__voloEditCalls=(globalThis.__voloEditCalls??0)+1;
        const mode=globalThis.__voloEditMode;
        if(mode?.startsWith('accept:')||mode?.startsWith('disable:')){
          const accepting=mode.startsWith('accept:');const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/')}+(accepting?'flight_requests?id=eq.':'memberships?user_id=eq.')+mode.slice(accepting?7:8),{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify(accepting?{status:'accepted'}:{status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned edit race'})});
          if(!changed.ok)throw new Error('Owned edit race setup failed');
        }
      }
      if(url.pathname==='/rest/v1/rpc/get_or_create_flight_conversation'){
        if(globalThis.__voloMessageMode==='open-outage')return Response.json({code:'private-message-error-canary'},{status:503});
        if(globalThis.__voloMessageMode==='open-delay')await new Promise(resolve=>setTimeout(resolve,3000));
        if(globalThis.__voloMessageMode?.startsWith('open-withdraw:')){
          const subject=globalThis.__voloMessageMode.slice(14);globalThis.__voloMessageMode='off';
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/flight_requests?id=eq.')}+subject,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'withdrawn'})});
          if(!changed.ok)throw new Error('Owned conversation entry race rejected');
        }
      }
      if(url.pathname==='/rest/v1/conversations'&&globalThis.__voloMessageMode==='open-read-outage')return Response.json({code:'private-message-error-canary'},{status:503});
      if(url.pathname==='/rest/v1/rpc/send_conversation_message'){globalThis.__voloMessageCalls=(globalThis.__voloMessageCalls??0)+1;if(globalThis.__voloMessageMode==='delay')await new Promise(resolve=>setTimeout(resolve,3000));}
      if(url.pathname==='/rest/v1/messages'&&globalThis.__voloMessageMode==='read-outage')return Response.json({code:'private-message-error-canary'},{status:503});
      if(url.pathname==='/rest/v1/rpc/admin_disable_member'&&globalThis.__voloMemberAdminMode==='delay')await new Promise(resolve=>setTimeout(resolve,3000));
      if(url.pathname==='/rest/v1/rpc/admin_disable_member'&&globalThis.__voloMemberAdminMode?.startsWith('disable-actor:')){
        const subject=globalThis.__voloMemberAdminMode.slice(14);globalThis.__voloMemberAdminMode='off';
        const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/memberships?user_id=eq.')}+subject,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned admin race'})});
        if(!changed.ok)throw Error('Owned admin race setup rejected');
      }
      const response=await original(input,{...init,redirect:'error'});
      if(url.pathname==='/rest/v1/rpc/admin_disable_member'){
        if(globalThis.__voloMemberAdminMode==='lost'){await response.text();throw Error('Owned disable response lost');}
        if(globalThis.__voloMemberAdminMode==='malformed'){await response.text();return Response.json({code:'disabled',userId:'private-member-admin-canary'});}
      }
      if(url.pathname==='/rest/v1/rpc/admin_member_overview'&&globalThis.__voloMemberAdminMode==='overview-malformed'){await response.text();return Response.json([{email:'private-member-admin-canary'}]);}
      if(url.pathname==='/rest/v1/rpc/get_or_create_flight_conversation'){
        if(globalThis.__voloMessageMode==='open-lost'){await response.text();throw new Error('Owned fixture discarded conversation response');}
        if(globalThis.__voloMessageMode==='open-malformed'){await response.text();return Response.json('private-message-error-canary');}
      }
      if(url.pathname==='/rest/v1/rpc/send_conversation_message'){
        if(globalThis.__voloMessageMode==='lost'){await response.text();throw new Error('Owned fixture discarded committed message response');}
        if(globalThis.__voloMessageMode==='malformed'){await response.text();return Response.json({id:'private-message-error-canary'});}
      }
      if(url.pathname==='/rest/v1/messages'&&globalThis.__voloMessageMode?.startsWith('disable-history:')){
        const subject=globalThis.__voloMessageMode.slice(16);globalThis.__voloMessageMode='off';
        const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/memberships?user_id=eq.')}+subject,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned history read race'})});
        if(!changed.ok)throw new Error('Owned history race setup rejected');
      }

      if(url.pathname==='/rest/v1/rpc/edit_flight'){
        if(globalThis.__voloEditMode==='lost'){await response.text();throw new Error('Owned fixture discarded committed edit response');}
        if(globalThis.__voloEditMode==='malformed'){await response.text();return Response.json({code:'updated',flightId:'private-edit-error-canary',updatedAt:'invalid'});}
      }
      if(url.pathname==='/rest/v1/rpc/get_network_profile'&&globalThis.__voloConnectionMode?.startsWith('withdraw-profile:')){
        const request=globalThis.__voloConnectionMode.slice(17);globalThis.__voloConnectionMode='off';
        const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/flight_requests?id=eq.')}+request,{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify({status:'withdrawn'})});
        if(!changed.ok)throw new Error('Owned connection profile-race setup rejected');
      }
      if(url.pathname==='/rest/v1/rpc/get_flight_connection'){
        const mode=globalThis.__voloConnectionMode;
        if(mode==='malformed'){await response.text();return Response.json({requestId:'private-connection-error-canary'});}
        if(mode?.startsWith('withdraw:')||mode?.startsWith('disable:')){
          globalThis.__voloConnectionMode='off';const withdrawing=mode.startsWith('withdraw:');
          const changed=await original(${JSON.stringify(stack.apiUrl+'/rest/v1/')}+(withdrawing?'flight_requests?id=eq.':'memberships?user_id=eq.')+mode.slice(withdrawing?9:8),{method:'PATCH',headers:{apikey:${JSON.stringify(stack.serverSecret)},Authorization:${JSON.stringify('Bearer '+stack.serverSecret)},'content-type':'application/json'},body:JSON.stringify(withdrawing?{status:'withdrawn'}:{status:'disabled',disabled_at:new Date().toISOString(),disabled_reason:'Owned connection read race'})});
          if(!changed.ok)throw new Error('Owned connection race setup rejected');
        }
      }
      if(url.pathname==='/rest/v1/rpc/cancel_flight'){
        if(globalThis.__voloCancellationMode==='lost'){await response.text();throw new Error('Owned fixture discarded committed cancellation response');}
        if(globalThis.__voloCancellationMode==='malformed'){await response.text();return Response.json({code:'cancelled',flightId:'private-cancellation-error-canary',status:'cancelled'});}
      }
      if(url.pathname==='/rest/v1/rpc/withdraw_flight_request'){
        if(globalThis.__voloWithdrawalMode==='lost'){await response.text();throw new Error('Owned fixture discarded committed withdrawal response');}
        if(globalThis.__voloWithdrawalMode==='malformed'){await response.text();return Response.json({code:'withdrawn',requestId:'private-withdrawal-error-canary',status:'withdrawn'});}
      }
      if(url.pathname==='/rest/v1/rpc/decide_flight_request'){
        if(globalThis.__voloDecisionMode==='lost'){await response.text();throw new Error('Owned fixture discarded committed decision response');}
        if(globalThis.__voloDecisionMode==='malformed'){await response.text();return Response.json({code:'decided',requestId:'private-decision-error-canary',status:'accepted'});}
      }
      if(globalThis.__voloFlightCreateMode==='malformed'&&['/rest/v1/rpc/create_flight','/rest/v1/rpc/create_private_flight'].includes(url.pathname)){await response.text();return Response.json('private-flight-error-canary');}
      if(globalThis.__voloFlightCreateMode==='lost'&&['/rest/v1/rpc/create_flight','/rest/v1/rpc/create_private_flight'].includes(url.pathname)){await response.text();throw new Error('Owned fixture discarded committed create response');}
      if(url.pathname==='/rest/v1/rpc/submit_flight_interest'){
        if(globalThis.__voloInterestMode==='malformed'){await response.text();return Response.json({code:'submitted',requestId:'private-interest-error-canary',status:'pending'});}
        if(globalThis.__voloInterestMode==='lost'){await response.text();throw new Error('Owned fixture discarded committed interest response');}
      }
      if(password&&!response.ok){const data=await response.clone().json();globalThis.__voloPasswordCode=data.code??data.error_code;}
      if(globalThis.__voloPhotoMode==='attach-lost'&&url.pathname==='/rest/v1/rpc/attach_profile_photo'){await response.text();throw new Error('Owned fixture discarded committed response');}
      if((mode==='password-lost'&&password)||(mode==='record-lost'&&url.pathname==='/rest/v1/rpc/record_invitation_password')||(mode==='redeem-lost'&&url.pathname==='/rest/v1/rpc/redeem_invitation')){await response.text();throw new Error('Owned fixture discarded committed response');}
      return response;
    };}`);
    if(browser){
      await cp(path.join(root,'app/globals.css'),path.join(directory,'app/globals.css'));
      await cp(path.join(root,'postcss.config.mjs'),path.join(directory,'postcss.config.mjs'));
    }
    await put('app/layout.tsx',browser?"import './globals.css';export default function Layout({children}:{children:React.ReactNode}){return <html lang=\"en\" className=\"h-full antialiased\"><body className=\"min-h-full flex flex-col\">{children}</body></html>}":'export default function Layout({children}:{children:React.ReactNode}){return <html><body>{children}</body></html>}' );
    await cp(path.join(root,'app/page.tsx'),path.join(directory,'app/page.tsx'));
    await cp(path.join(root,'app/api/health'),path.join(directory,'app/api/health'),{recursive:true});
    if(photos)await put('app/api/photo-control/route.ts',`type State=typeof globalThis & {__voloPhotoMode?:string};export async function POST(request:Request){const mode=await request.text();if(!['off','delete-failure','upload-failure','attach-lost'].includes(mode))return new Response(null,{status:400});(globalThis as State).__voloPhotoMode=mode;return Response.json({fixture:true});}`);
    await put('app/api/login-control/route.ts',`type State=typeof globalThis & {__voloLoginMode?:string;__voloLoginCalls?:number};export async function GET(){return Response.json({calls:(globalThis as State).__voloLoginCalls??0});}export async function POST(request:Request){const mode=await request.text();if(!['off','outage','malformed'].includes(mode))return new Response(null,{status:400});(globalThis as State).__voloLoginMode=mode;return Response.json({fixture:true});}`);
    await put('app/api/recovery-control/route.ts',`type State=typeof globalThis & {__voloRecoveryMode?:string;__voloRecoveryCalls?:number};export async function GET(){return Response.json({calls:(globalThis as State).__voloRecoveryCalls??0});}export async function POST(request:Request){const mode=await request.text();if(!['off','outage','rate-limit','malformed'].includes(mode))return new Response(null,{status:400});(globalThis as State).__voloRecoveryMode=mode;return Response.json({fixture:true});}`);
    await put('app/api/logout-control/route.ts',`type State=typeof globalThis & {__voloLogoutMode?:string;__voloLogoutCalls?:number};export async function GET(){return Response.json({calls:(globalThis as State).__voloLogoutCalls??0});}export async function POST(request:Request){const mode=await request.text();if(!['off','outage','delay'].includes(mode))return new Response(null,{status:400});(globalThis as State).__voloLogoutMode=mode;return Response.json({fixture:true});}`);
    await put('app/dashboard/layout.tsx',"export {default,dynamic} from '../../protected-layout';");
    await put('app/dashboard/page.tsx',`import {mutate,adminMutate} from '../actions';import Form from '../form';import AppShell from '../(protected)/_components/app-shell';import {getPageAccess} from '../../lib/auth/page-access';export default async function Page(){const access=await getPageAccess();if(access.status!=='authorized')return <p>Access denied</p>;return <AppShell isAdmin={access.member.role==='admin'}><p>subject:{access.member.userId} role:{access.member.role}</p><Form action={mutate} label="Write"/><Form action={adminMutate} label="Admin"/></AppShell>;}`);
    await put('app/api/confirmation-session/route.ts',`import {getVerifiedInvitationSetup} from '../../../lib/auth/invitation-setup';import {verifyConfirmationSession,createConfirmationAuthTransport} from '../../../lib/auth/invitation-confirmation-auth';import {createServerSupabaseClient} from '../../../lib/supabase/server';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(){const headers=new Headers();applyPrivateResponseHeaders(headers);const transport=createConfirmationAuthTransport();try{const client=await createServerSupabaseClient({cookieMode:'read-write',fetch:transport.fetch,setResponseHeaders(){}});const session=await verifyConfirmationSession(client);return Response.json({session:session.code==='verified'?{code:session.code,subject:session.identity.subject}:session,setup:await getVerifiedInvitationSetup()},{headers});}finally{transport.close();}}`);
    await put('app/api/completion-form/route.ts',`import {getInvitationCompletionCsrf} from '../../../lib/auth/invitation-setup';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(){const headers=new Headers();applyPrivateResponseHeaders(headers);return Response.json({csrf:await getInvitationCompletionCsrf()},{headers});}`);
    await put('app/api/completion-control/route.ts',`type State=typeof globalThis & {__voloCompletionMode?:string;__voloPasswordWrites?:number;__voloCompletionAuthReads?:number;__voloPasswordCode?:string};export async function GET(){const s=globalThis as State;return Response.json({writes:s.__voloPasswordWrites??0,authReads:s.__voloCompletionAuthReads??0,providerCode:s.__voloPasswordCode??null});}export async function POST(request:Request){const mode=await request.text();if(!['off','password-lost','record-lost','record-failure','redeem-lost'].includes(mode))return new Response(null,{status:400});(globalThis as State).__voloCompletionMode=mode;return Response.json({fixture:true});}`);
    await put('app/api/completion-policy/route.ts',`import {createServerSupabaseClient} from '../../../lib/supabase/server';import {createCompletionAuthTransport,setInvitationPassword} from '../../../lib/auth/invitation-completion-auth';import {verifyConfirmationSession} from '../../../lib/auth/invitation-confirmation-auth';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function POST(){const headers=new Headers();applyPrivateResponseHeaders(headers);const transport=createCompletionAuthTransport();try{const client=await createServerSupabaseClient({cookieMode:'read-write',fetch:transport.fetch,setResponseHeaders(updates){for(const [k,v] of Object.entries(updates))headers.set(k,v);}}),verified=await verifyConfirmationSession(client);return Response.json(verified.code==='verified'?await setInvitationPassword(client,'short',verified.identity.subject,transport):{code:'unknown'},{headers});}finally{transport.close();}}`);
    await put('app/api/confirmation-failure/route.ts',`export async function POST(request:Request){(globalThis as typeof globalThis & {__voloFailSetup?:boolean}).__voloFailSetup=(await request.text())==='on';return Response.json({fixture:true});}`);
    await put('app/api/subject/route.ts',`import {getAccess} from '../../../lib/auth/access';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(){const access=await getAccess();const headers=new Headers();applyPrivateResponseHeaders(headers);return Response.json(access.status==='authorized'?{userId:access.member.userId,role:access.member.role}:{status:access.status},{headers,status:access.status==='authorized'?200:access.status==='unauthenticated'?401:access.status==='forbidden'?403:503});}`);
    await put('fixture-policy.ts',`import type {MutationPolicy} from './lib/auth/mutation';export function policy(admin=false):MutationPolicy<{value:string},{saved:boolean}>{return {allowedRoles:admin?['admin']:['member','admin'],parse(raw){return raw&&typeof raw==='object'&&'value' in raw&&raw.value==='valid'?{ok:true,value:{value:'valid'}}:{ok:false};},authorize(){return true;},async effect(member){const response=await fetch(${JSON.stringify(recordOrigin+'/effect')},{method:'POST',body:JSON.stringify({userId:member.userId}),cache:'no-store'});if(!response.ok)throw new Error('Recorder rejected effect');return {saved:true};}};}`);
    await put('app/api/invitations/route.ts',`import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {invitationIssuancePolicy} from '../../../lib/auth/invitation-issuance';export function POST(request:Request){return handleRouteMutation(request,{method:'POST',policy:invitationIssuancePolicy()});}`);
    await put('app/api/invitation-race/route.ts',`import {randomUUID} from 'node:crypto';import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {invitationIssuancePolicy} from '../../../lib/auth/invitation-issuance';import {executeInitialInvitation} from '../../../lib/auth/invitation-send';import {createInitialSendPorts} from '../../../lib/auth/invitation-send-provider';export function POST(request:Request){const policy=invitationIssuancePolicy();policy.effect=async(member,input)=>{const ports=createInitialSendPorts();const create=ports.createSubject;ports.createSubject=async(id,email)=>{const competing=await create(randomUUID(),email);if(competing.code!=='accepted')throw new Error('Owned race fixture failed');return create(id,email);};return executeInitialInvitation({operationId:randomUUID(),recipientEmail:input.email,requesterId:member.userId},ports);};return handleRouteMutation(request,{method:'POST',policy});}`);
    await put('resend-receipts.ts',`import type {TrustedSendObservation} from './lib/auth/invitation-resend';export const receipts=new Map<string,TrustedSendObservation>();`);
    await put('app/api/invitation-renew/[mode]/route.ts',`import {randomUUID} from 'node:crypto';import {handleRouteMutation} from '../../../../lib/auth/route-mutation';import {invitationResendPolicy,invitationSendInspectionPolicy} from '../../../../lib/auth/invitation-issuance';import {executeInvitationResend,reconcileInvitationSend} from '../../../../lib/auth/invitation-resend';import {createResendPorts,createSendReconciliationPorts} from '../../../../lib/auth/invitation-send-provider';import {receipts} from '../../../../resend-receipts';
export function POST(request:Request){const mode=new URL(request.url).pathname.split('/').at(-1);if(!['normal','lost-response','lost-record','inspect','reconcile'].includes(mode??''))return new Response(null,{status:404});const policy=mode==='inspect'?invitationSendInspectionPolicy():invitationResendPolicy();
if(mode==='lost-response'||mode==='lost-record')policy.effect=async(member,input)=>{const ports=createResendPorts(),send=ports.send;ports.send=async(r,transport,secret,canSend)=>{const observed=await send(r,transport,secret,canSend);if(mode==='lost-record'&&observed.code==='accepted')receipts.set(r.invitationId,{attemptId:r.attemptId,version:r.version,outcome:'accepted',identity:observed.identity});return mode==='lost-response'?{code:'unknown',errorCode:'timeout'}:observed;};if(mode==='lost-record')ports.record=async()=>{throw new Error('Owned fixture lost recording');};return executeInvitationResend({operationId:randomUUID(),invitationId:input.invitationId,expectedVersion:input.expectedVersion,requesterId:member.userId},ports);};
if(mode==='reconcile')policy.effect=async(member,input)=>{const observed=receipts.get(input.invitationId);if(!observed)return {code:'pending_reconciliation'};return reconcileInvitationSend({attemptId:observed.attemptId,expectedVersion:input.expectedVersion,requesterId:member.userId},observed,createSendReconciliationPorts());};return handleRouteMutation(request,{method:'POST',policy});}`);
    await put('app/api/write/route.ts',`import {handleRouteMutation} from '../../../lib/auth/route-mutation';import {policy} from '../../../fixture-policy';export function POST(request:Request){return handleRouteMutation(request,{method:'POST',policy:policy(new URL(request.url).searchParams.has('admin'))});}`);
    await put('app/actions.ts',`'use server';import {handleActionMutation} from '../lib/auth/action-mutation';import {policy} from '../fixture-policy';export async function mutate(_previous:unknown,form:FormData){return handleActionMutation(form,policy());}export async function adminMutate(_previous:unknown,form:FormData){return handleActionMutation(form,policy(true));}`);
    await put('app/form.tsx',`'use client';import {useActionState} from 'react';export default function Form({action,label}:{action:(previous:unknown,form:FormData)=>Promise<unknown>;label:string}){const [state,submit]=useActionState(action,null);return <form action={submit}><input name="value" defaultValue="valid"/><button>{label}</button><output>{JSON.stringify(state)}</output></form>;}`);
    await put('app/forms/page.tsx',`import {mutate,adminMutate} from '../actions';import Form from '../form';export default function Page(){return <main><Form action={mutate} label="Write"/><Form action={adminMutate} label="Admin"/></main>}`);
    if(memberAdmin){
      await put('app/api/member-admin-control/route.ts',`type State=typeof globalThis & {__voloMemberAdminMode?:string};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed','overview-malformed','delay','action-lost'].includes(mode)&&!/^disable-actor:[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloMemberAdminMode=mode;return Response.json({ok:true});}`);
      const memberActionPath=path.join(directory,'app/(protected)/admin/members/actions.ts');
      await writeFile(memberActionPath,(await readFile(memberActionPath,'utf8')).replace(" if(state.status==='disabled')refresh();"," if(state.status==='disabled'&&(globalThis as typeof globalThis & {__voloMemberAdminMode?:string}).__voloMemberAdminMode==='action-lost')throw Error('Owned member action response lost');\n if(state.status==='disabled')refresh();"));
      await put('app/admin/member-fixture/page.tsx',`import {disableMember} from '../../../lib/auth/member-admin-actions';import Form from '../../form';export default function Page(){return <main><Form action={disableMember} label="Disable member"/></main>}`);
      await put('app/api/member-overview/route.ts',`import {listAdminMembers} from '../../../lib/auth/member-admin-query';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(request:Request){const value=await listAdminMembers(new URL(request.url).searchParams.get('after')??undefined);const headers=new Headers();applyPrivateResponseHeaders(headers);return Response.json(value,{headers});}`);
    }
    if(flights){
      await put('app/dashboard/message-fixture/page.tsx',`import {sendMessage} from '../../../lib/messages/actions';import Form from '../../form';export default function Page(){return <main><Form action={sendMessage} label="Message fixture"/></main>}`);
      await put('app/api/message-history/route.ts',`import {getConversationHistory} from '../../../lib/messages/history-query';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(request:Request){const url=new URL(request.url),response=Response.json(await getConversationHistory(url.searchParams.get('conversation'),url.searchParams.get('before')));applyPrivateResponseHeaders(response.headers);return response;}`);
      await put('app/api/message-control/route.ts',`type State=typeof globalThis & {__voloMessageMode?:string;__voloMessageCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed','read-outage','delay','action-lost','open-outage','open-delay','open-lost','open-malformed','open-read-outage'].includes(mode)&&!/^(disable-history|open-withdraw):[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloMessageMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloMessageCalls??0});}`);

      await put('app/api/flight-connection/route.ts',`import {getFlightConnection} from '../../../lib/flights/connection-query';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(request:Request){const response=Response.json(await getFlightConnection(new URL(request.url).searchParams.get('request')));applyPrivateResponseHeaders(response.headers);return response;}`);
      await put('app/api/connection-control/route.ts',`type State=typeof globalThis & {__voloConnectionMode?:string};export async function POST(request:Request){const mode=await request.text();if(!['off','malformed'].includes(mode)&&!/^(withdraw|disable|withdraw-profile):[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloConnectionMode=mode;return Response.json({ok:true});}`);
      await put('app/api/cancellation-control/route.ts',`type State=typeof globalThis & {__voloCancellationMode?:string;__voloCancellationCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed'].includes(mode))return new Response(null,{status:400});(globalThis as State).__voloCancellationMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloCancellationCalls??0});}`);
      await put('app/api/edit-control/route.ts',`type State=typeof globalThis & {__voloEditMode?:string;__voloEditCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed'].includes(mode)&&!/^(accept|disable):[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloEditMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloEditCalls??0});}`);
      await cp(path.join(root,'app/(protected)/dashboard/connections'),path.join(directory,'app/(protected)/dashboard/connections'),{recursive:true});
      await cp(path.join(root,'app/(protected)/messages'),path.join(directory,'app/(protected)/messages'),{recursive:true});
      const chatActionPath=path.join(directory,'app/(protected)/messages/[conversationId]/actions.ts');
      await writeFile(chatActionPath,(await readFile(chatActionPath,'utf8')).replace(" if(state.status==='sent')refresh();"," if(state.status==='sent'&&(globalThis as typeof globalThis & {__voloMessageMode?:string}).__voloMessageMode==='action-lost')throw Error('Owned fixture discarded committed chat action');\n if(state.status==='sent')refresh();"));
      await cp(path.join(root,'app/(protected)/dashboard/flights'),path.join(directory,'app/(protected)/dashboard/flights'),{recursive:true});
      await put('app/dashboard/flight-create-fixture/page.tsx',`import {createFlight} from '../../../lib/flights/actions';import Form from '../../form';export default function Page(){return <main><Form action={createFlight} label="Create flight"/></main>}`);
      await put('app/api/flight-create-control/route.ts',`type State=typeof globalThis & {__voloFlightCreateMode?:string;__voloFlightCreateCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed'].includes(mode)&&!/^disable:[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloFlightCreateMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloFlightCreateCalls??0});}`);
      await put('app/api/flight-feed-fixture/route.ts',`import {listUpcomingFlights} from '../../../lib/flights/feed-query';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function POST(request:Request){const response=Response.json(await listUpcomingFlights(await request.json()));applyPrivateResponseHeaders(response.headers);return response;}`);
      await put('app/api/flight-feed-control/route.ts',`type State=typeof globalThis & {__voloFlightFeedMode?:string;__voloFlightFeedCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','outage','delay'].includes(mode)&&!/^disable-after-read:[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloFlightFeedMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloFlightFeedCalls??0});}`);
      await put('app/dashboard/recipient-fixture/page.tsx',`import {addFlightRecipient,removeFlightRecipient} from '../../../lib/flights/actions';import Form from '../../form';export default function Page(){return <main><Form action={addFlightRecipient} label="Add"/><Form action={removeFlightRecipient} label="Remove"/></main>}`);
      await put('app/api/recipient-candidates/route.ts',`import {listRecipientCandidates} from '../../../lib/flights/recipient-query';import {applyPrivateResponseHeaders} from '../../../lib/http/private-response';export async function GET(){const response=Response.json(await listRecipientCandidates());applyPrivateResponseHeaders(response.headers);return response;}`);
    }
    if(interest){
      await put('app/api/withdrawal-control/route.ts',`type State=typeof globalThis & {__voloWithdrawalMode?:string;__voloWithdrawalCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed'].includes(mode)&&!/^disable:[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloWithdrawalMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloWithdrawalCalls??0});}`);
      await put('app/api/decision-control/route.ts',`type State=typeof globalThis & {__voloDecisionMode?:string;__voloDecisionCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed'].includes(mode)&&!/^disable:[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloDecisionMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloDecisionCalls??0});}`);
      await cp(path.join(root,'app/(protected)/onboarding'),path.join(directory,'app/(protected)/onboarding'),{recursive:true});
      await put('app/dashboard/interest-fixture/page.tsx',`import {submitFlightInterest} from '../../../lib/flights/actions';import Form from '../../form';export default function Page(){return <main><Form action={submitFlightInterest} label="Interested fixture"/></main>}`);
      await put('app/api/interest-control/route.ts',`type State=typeof globalThis & {__voloInterestMode?:string;__voloInterestCalls?:number};export async function POST(request:Request){const mode=await request.text();if(!['off','lost','malformed','read-outage'].includes(mode)&&!/^(disable|full|profile-timeout):[a-f0-9-]{36}$/.test(mode))return new Response(null,{status:400});(globalThis as State).__voloInterestMode=mode;return Response.json({ok:true});}export function GET(){return Response.json({calls:(globalThis as State).__voloInterestCalls??0});}`);
    }
    if(browser)await cp(path.join(root,'app/(protected)/layout.tsx'),path.join(directory,'app/dashboard/layout.tsx'));
    if(browser)await put('app/dashboard/page.tsx',(await readFile(path.join(root,'app/(protected)/dashboard/page.tsx'),'utf8')).replaceAll('../../../lib/','../../lib/').replaceAll('../_components/','../(protected)/_components/'));
    fixtureStage='build';const build=await promisify(execFile)(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'build',directory,'--webpack'],{cwd:directory,env,signal,timeout:180000,maxBuffer:8*1024*1024});output+=build.stdout+build.stderr;signal?.throwIfAborted();
    fixtureStage='start';server=spawn(process.execPath,[path.join(root,'node_modules/next/dist/bin/next'),'start',directory,'--hostname','127.0.0.1','--port',String(port)],{cwd:directory,env,stdio:['ignore','pipe','pipe']});
    let startError;server.on('error',()=>{startError=true;});for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{output=(output+data).slice(-4*1024*1024);});
    let ready=false;for(let i=0;i<100;i++){signal?.throwIfAborted();if(startError||server.exitCode!==null)throw new Error();try{const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});await response.text();if(response.status===200){ready=true;break;}}catch{}await delay(100);}if(!ready)throw new Error();
    const request=async(route,{session,method='GET',headers:additional={},body}={})=>{
      const destination=new URL(route,origin);if(destination.origin!==origin)throw new Error('Fixture request must stay local');
      const headers=new Headers(additional);if(session)headers.set('Cookie',session.cookieHeader());
      const response=await fetch(destination,{method,headers,body,redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});session?.applyResponse(response);return response;
    };
    const invokeFlightAction=async(route,fields,{session,transport='fetched',origin:requestOrigin=origin,postRoute=route,formHtml,formRequestId,formIntent,formTargetId}={})=>{
        let html=formHtml??await (await request(route,{session})).text();
        if(formIntent){const selected=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(match=>match[1].includes('name="intent"')&&match[1].includes('value="'+formIntent+'"'));if(!selected)throw new Error('Owned intent form missing');html=selected[1];}
        if(formRequestId){const selected=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(match=>match[1].includes('name="request_id"')&&match[1].includes('value="'+formRequestId+'"'));if(!selected)throw new Error('Owned decision form missing');html=selected[1];}
        if(formTargetId){const selected=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].find(match=>match[1].includes('name="target_id"')&&match[1].includes('value="'+formTargetId+'"'));if(!selected)throw new Error('Owned member control missing');html=selected[1];}
        const reserved=[...html.matchAll(/<input\b[^>]*>/g)].flatMap(input=>{const name=input[0].match(/name="(\$ACTION_[^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];});
        const actionId=JSON.parse(reserved.find(([name])=>name.endsWith(':0'))[1]).id;
        const headers=new Headers();if(requestOrigin!==null)headers.set('Origin',requestOrigin);
        const form=new FormData();for(const [key,value] of Object.entries(fields))if(value!==undefined)form.set(key,String(value));
        let body;
        if(transport==='native'){for(const [key,value] of reserved)form.append(key,value);body=form;}
        else {body=await encodeReply([null,form]);headers.set('Accept','text/x-component');headers.set('Next-Action',actionId);}
        return request(postRoute,{session,method:'POST',headers,body});
    };
    fixtureStage='action-metadata';const html=await (await request('/forms')).text();
    const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].map(match=>[...match[1].matchAll(/<input\b[^>]*>/g)].flatMap(input=>{const name=input[0].match(/name="(\$ACTION_[^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];}));
    const ids=forms.map(entries=>JSON.parse(entries.find(([name])=>name.endsWith(':0'))[1]).id);if(ids.length!==2)throw new Error();
    const {encodeReply}=createRequire(import.meta.url)('next/dist/compiled/react-server-dom-webpack/client.node.js');
    return {origin,request,close,effects:()=>effects.slice(),diagnostics:()=>output,
      async invitationForms(session){
        const html=await (await request('/admin/invitations',{session})).text();
        return [...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)].filter(match=>match[1].includes('$ACTION_')).map(match=>{
          const fields=[...match[1].matchAll(/<input\b[^>]*>/g)].flatMap(input=>{const name=input[0].match(/name="([^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];});
          const kind=fields.some(([name])=>name==='email')?'send':match[1].includes('Renew provider link')?'renew':'inspect';
          return {kind,fields,id:JSON.parse(fields.find(([name])=>name.endsWith(':0'))[1]).id};
        });
      },
      async invitationAction(form,{session,fields={},origin:requestOrigin=origin,transport='native'}={}){
        const headers=new Headers({Origin:requestOrigin});let body;
        if(transport==='native'){body=new FormData();for(const [key,value] of form.fields)body.append(key,value);for(const [key,value] of Object.entries(fields))body.set(key,value);}
        else {const data=new FormData();for(const [key,value] of form.fields)if(!key.startsWith('$ACTION_'))data.append(key,value);for(const [key,value] of Object.entries(fields))data.set(key,value);body=await encodeReply([null,data]);headers.set('Accept','text/x-component');headers.set('Next-Action',form.id);}
        return request('/admin/invitations',{session,method:'POST',headers,body});
      },
      createFlight(fields,{page=false,...settings}={}){
        return invokeFlightAction(page?'/dashboard/flights/new':'/dashboard/flight-create-fixture',fields,settings);
      },
      sendMessage(fields,settings={}){return invokeFlightAction('/dashboard/message-fixture',fields,settings);},
      disableMember(fields,settings={}){return invokeFlightAction('/admin/member-fixture',fields,settings);},
      memberPageAction(id,fields,{after,fromTargetId=id,...settings}={}){return invokeFlightAction('/admin/members'+(after?'?after='+after:''),{target_id:id,reason:'Owned UI safety review',confirmation:'disable',...fields},{...settings,formTargetId:fromTargetId});},
      connectionPageAction(id,fields,{fromRequestId=id,...settings}={}){return invokeFlightAction('/dashboard/connections/'+fromRequestId,{request_id:id,...fields},{...settings,formRequestId:fromRequestId});},
      async chatPageAction(thread,fields,{formHtml,...settings}={}){
        const route='/messages/'+thread,html=formHtml??await(await request(route,settings)).text();
        const input=[...html.matchAll(/<input\b[^>]*>/g)].find(match=>match[0].includes('name="message_id"'))?.[0];
        const messageId=decode(input?.match(/value="([^"]*)"/)?.[1]??'');
        return invokeFlightAction(route,{conversation_id:thread,message_id:messageId,...fields},{...settings,formHtml:html});
      },
      submitInterest(fields,settings={}){return invokeFlightAction('/dashboard/interest-fixture',fields,settings);},
      cancellationPageAction(id,fields,settings={}){return invokeFlightAction('/dashboard/flights/'+id,{flight_id:id,intent:'cancel',confirmation:'cancel',...fields},{...settings,formIntent:'cancel'});},
      async editPageAction(id,overrides,{formHtml,...settings}={}){
        const route='/dashboard/flights/'+id+'/edit',html=formHtml??await(await request(route,settings)).text(),fields={};
        for(const match of html.matchAll(/<input\b[^>]*>/g)){const name=match[0].match(/name="([^"]+)"/)?.[1];if(name&&!name.startsWith('$ACTION_'))fields[decode(name)]=decode(match[0].match(/value="([^"]*)"/)?.[1]??'');}
        for(const match of html.matchAll(/<textarea\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/g))fields[decode(match[1])]=decode(match[2]);
        if(fields.departure_occurrence===undefined)fields.departure_occurrence=decode(html.match(/<option[^>]*value="([^"]*)"[^>]*selected[^>]*>/)?.[1]??'');
        return invokeFlightAction(route,{...fields,...overrides},{...settings,formHtml:html});
      },
      interestPageAction(id,fields,{fromFlightId=id,...settings}={}){return invokeFlightAction('/dashboard/flights/'+fromFlightId,{flight_id:id,...fields},{...settings,postRoute:'/dashboard/flights/'+id});},
      decisionPageAction(id,requestId,fields,{fromRequestId=requestId,...settings}={}){return invokeFlightAction('/dashboard/flights/'+id,{flight_id:id,request_id:requestId,...fields},{...settings,formRequestId:fromRequestId});},
      async recipientAction(selected,fields,{session,transport='fetched',origin:requestOrigin=origin}={}){
        const route='/dashboard/recipient-fixture';const html=await (await request(route,{session})).text();
        const forms=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/g)];
        const contents=forms[selected?0:1][1];
        const reserved=[...contents.matchAll(/<input\b[^>]*>/g)].flatMap(input=>{const name=input[0].match(/name="(\$ACTION_[^"]+)"/)?.[1];return name?[[decode(name),decode(input[0].match(/value="([^"]*)"/)?.[1]??'')]]:[];});
        const actionId=JSON.parse(reserved.find(([name])=>name.endsWith(':0'))[1]).id;
        const headers=new Headers();if(requestOrigin!==null)headers.set('Origin',requestOrigin);
        const form=new FormData();for(const [key,value] of Object.entries(fields))form.set(key,String(value));let body;
        if(transport==='native'){for(const [key,value] of reserved)form.append(key,value);body=form;}
        else{body=await encodeReply([null,form]);headers.set('Accept','text/x-component');headers.set('Next-Action',actionId);}
        return request(route,{session,method:'POST',headers,body});
      },
      async scanStatic(check){async function scan(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await scan(file);else check(await readFile(file,'utf8'));}}await scan(path.join(directory,'.next/static'));},
      async mutate(transport,{session,origin:requestOrigin=origin,admin=false}={}) {
        const headers=new Headers();if(requestOrigin!==null)headers.set('Origin',requestOrigin);
        if(transport==='json'){headers.set('content-type','application/json');return request('/api/write'+(admin?'?admin':''),{session,method:'POST',headers,body:JSON.stringify({value:'valid'})});}
        const form=new FormData();form.set('value','valid');let body;const index=admin?1:0;
        if(transport==='fetched'){body=await encodeReply([null,form]);headers.set('Accept','text/x-component');headers.set('Next-Action',ids[index]);}
        else if(transport==='native'){body=new FormData();for(const [key,value] of forms[index])body.append(key,value);body.set('value','valid');}
        else throw new Error('Unknown mutation transport');
        return request('/dashboard',{session,method:'POST',headers,body});
      },
    };
  }catch(error){
    const diagnostic=sanitizeDiagnostics(`Fixture stage: ${fixtureStage}\n${error.message}\n`+output+(error.stdout??'')+(error.stderr??''),[stack.publicKey,stack.serverSecret]);
    await mkdir(evidenceDirectory(root),{recursive:true});await writeFile(path.join(evidenceDirectory(root),'fixture-diagnostic.log'),diagnostic,{mode:0o600});
    await close();const failure=new Error('Real Auth Next fixture build/start failed; raw child output withheld');failure.fixtureDiagnostic=diagnostic.slice(-6000);throw failure;
  }
}
