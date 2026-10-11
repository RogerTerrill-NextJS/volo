import assert from 'node:assert/strict';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import sharp from 'sharp';
import {startLocalAuthStack,cleanupOwnedStack,localProcessEnvironment,reservePort} from '../tests/helpers/local-auth-stack.mjs';
import {startRealAuthApp} from '../tests/helpers/real-auth-app.mjs';
import {signInSession} from '../tests/helpers/real-auth-session.mjs';

const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'.superpowers/sdd/2026-10-11-volo-164-profile-photo');
const stateFile=path.join(directory,'photo-owned-stack.json'),exec=promisify(execFile);
if(process.argv.length===3&&process.argv[2]==='--cleanup'){await cleanupOwnedStack(root,{stateFile});process.exit(0);}
if(process.argv.length!==2)throw new Error('Usage: node scripts/verify-profile-photos.mjs [--cleanup]');
const summary={scenarios:[],passed:0,failed:0,limitations:['Owned local services only; hosted preview/release and hosted daily cleanup not verified.']};
let stack,app,admin,backendRoot,storageToken,currentScenario='setup';
const accounts=[],sessions=[];
async function scenario(name,run){currentScenario=name;await run();summary.scenarios.push(name);summary.passed++;console.log(`Passed: ${name}`);}
async function sql(query){
 const state=JSON.parse(await readFile(stateFile,'utf8'));
 assert.equal(state.projectId,stack.projectId);assert.equal(state.workdir,stack.workdir);
 assert.ok((await readFile(path.join(stack.workdir,'supabase/config.toml'),'utf8')).includes(`project_id = "${stack.projectId}"`));
 const result=await exec('docker',['exec',`supabase_db_${stack.projectId}`,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atc',query],{env:localProcessEnvironment(),timeout:30000,maxBuffer:1024*1024});return result.stdout;
}
async function rpc(name,args={}){const result=await admin.rpc(name,args).retry(false);if(result.error)throw new Error(`Service RPC failed: ${name} (${result.error.code}): ${result.error.message}`);return result.data;}
async function cleanup(){
 const rows=await rpc('claim_profile_photo_cleanup',{batch_size:20});
 for(const row of rows){
  for(const [bucket,key] of [['profile-photo-uploads',row.source_path],['profile-photos',row.final_path]])if(key){const r=await admin.storage.from(bucket).remove([key]);assert.equal(r.error,null,'Storage cleanup failed');}
  assert.equal((await rpc('ack_profile_photo_cleanup',{reservation_id:row.id,claim_token:row.claim_token,source_deleted:true,final_deleted:true})).code,'acknowledged');
 }
 return rows;
}
async function pointer(owner){const r=await admin.from('profiles').select('photo_storage_path').eq('user_id',owner.id).single();assert.equal(r.error,null);return r.data.photo_storage_path;}
async function call(route,session,{body={},method='POST',origin=app.origin}={}){
 const r=await app.request(route,{session,method,headers:{Origin:origin,...(method==='DELETE'?{}:{'content-type':'application/json'})},body:method==='DELETE'?undefined:JSON.stringify(body)});
 assert.match(r.headers.get('cache-control')??'',/no-store/);
 const text=await r.text();stack.assertNoCredentialLeaks(text);for(const s of sessions)s.assertNoCredentialLeaks(text);
 return {status:r.status,data:JSON.parse(text)};
}
async function reserve(session){const r=await call('/api/profile/photo/uploads',session);assert.equal(r.status,200);assert.equal(r.data.data.code,'reserved');return r.data.data;}
async function upload(client,reservation,bytes,mime='image/png'){return client.storage.from('profile-photo-uploads').upload(reservation.sourcePath,bytes,{contentType:mime,upsert:false});}
async function save(session,client,bytes,mime='image/png'){
 const r=await reserve(session);assert.equal((await upload(client,r,bytes,mime)).error,null,'Direct upload failed');
 const result=await call('/api/profile/photo',session,{body:{reservation_id:r.reservationId}});return {r,result};
}
try{
 const origin=`http://127.0.0.1:${await reservePort()}`;
 stack=await startLocalAuthStack({repositoryRoot:root,stateFile,applicationOrigin:origin});
 backendRoot=(await exec('docker',['exec',`supabase_storage_${stack.projectId}`,'printenv','FILE_STORAGE_BACKEND_PATH'],{env:localProcessEnvironment(),timeout:5000})).stdout.trim();
 assert.match(backendRoot,/^\/[a-zA-Z0-9_/-]+$/);
 storageToken=JSON.parse((await exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),'status','--workdir',stack.workdir,'-o','json'],{env:localProcessEnvironment(),timeout:10000,maxBuffer:1024*1024})).stdout).SERVICE_ROLE_KEY;
 admin=createClient(stack.apiUrl,stack.serverSecret,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 for(const label of ['photo-owner','photo-admin','photo-no-profile'])accounts.push(await stack.createAccount({label,role:label==='photo-admin'?'admin':'member'}));
 const [owner,other]=accounts;
 for(const a of [owner,other]){const r=await admin.from('profiles').insert({user_id:a.id,display_name:a===owner?'Owner':'Other',home_airport:'KPAO',pilot_designation:'student'});assert.equal(r.error,null,'Profile provisioning failed');}
 for(const a of accounts)sessions.push(await signInSession(stack,a));
 const [A,B,C]=sessions;
 const clients=[];
 for(const a of [owner,other]){const client=createClient(stack.apiUrl,stack.publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});assert.equal((await client.auth.signInWithPassword({email:a.email,password:a.password})).error,null);clients.push(client);}
 const [a,b]=clients;
 app=await startRealAuthApp({repositoryRoot:root,stack,applicationOrigin:origin,photos:true});
 const png=await sharp({create:{width:1024,height:512,channels:3,background:'red'}}).png().toBuffer();
 const mode=async value=>{assert.equal((await app.request('/api/photo-control',{method:'POST',body:value})).status,200);};
 await scenario('fresh guards reject Origin, anonymous, no profile and extra identifiers',async()=>{
  const before=await admin.from('profile_photo_objects').select('id');
  assert.equal((await call('/api/profile/photo/uploads',A,{origin:'https://foreign.example.invalid'})).status,403);
  assert.equal((await call('/api/profile/photo/uploads',undefined)).status,401);
  assert.equal((await call('/api/profile/photo/uploads',C)).status,403);
  assert.equal((await call('/api/profile/photo/uploads',A,{body:{owner_id:other.id}})).status,400);
  assert.equal((await call('/api/profile/photo?owner_id='+other.id,A,{method:'DELETE'})).status,400);
  const after=await admin.from('profile_photo_objects').select('id');assert.deepEqual(after.data,before.data);
 });
 let first;
 await scenario('owner-only temporary upload and immutable member-visible final',async()=>{
  first=await reserve(A);assert.equal(first.sourcePath,`${owner.id}/${first.reservationId}/source`);
  assert.notEqual((await upload(b,first,png)).error,null,'Foreign owner upload denied');
  assert.equal((await call('/api/profile/photo',B,{body:{reservation_id:first.reservationId}})).status,409);
  assert.equal((await upload(a,first,png)).error,null);
  assert.notEqual((await upload(a,first,png)).error,null,'Overwrite denied');
  assert.notEqual((await a.storage.from('profile-photo-uploads').download(first.sourcePath)).error,null,'Raw source read denied');
  assert.notEqual((await a.storage.from('profile-photo-uploads').move(first.sourcePath,first.sourcePath+'x')).error,null,'Move denied');
  await a.storage.from('profile-photo-uploads').remove([first.sourcePath]);
  assert.equal((await admin.storage.from('profile-photo-uploads').download(first.sourcePath)).error,null,'Client delete must leave source intact');
  const result=await call('/api/profile/photo',A,{body:{reservation_id:first.reservationId}});assert.equal(result.status,200);assert.equal(result.data.data.code,'saved');
  const key=await pointer(owner);assert.equal(key,`${owner.id}/${first.reservationId}.webp`);
  const image=await b.storage.from('profile-photos').download(key);assert.equal(image.error,null);
  const meta=await sharp(Buffer.from(await image.data.arrayBuffer())).metadata();assert.equal(meta.width,512);assert.equal(meta.height,256);assert.equal(meta.format,'webp');assert.equal(meta.exif,undefined);
  const publicResponse=await fetch(`${stack.apiUrl}/storage/v1/object/public/profile-photos/${key}`);assert.notEqual(publicResponse.status,200);
  await b.storage.from('profile-photos').remove([key]);assert.equal((await admin.storage.from('profile-photos').download(key)).error,null,'Other pilot cannot delete final');
  assert.notEqual((await a.storage.from('profile-photos').upload(key,png,{contentType:'image/webp',upsert:true})).error,null,'Client final writes denied');
  assert.notEqual((await admin.storage.from('profile-photo-uploads').download(first.sourcePath)).error,null,'Original physically removed');
 });
 await scenario('invalid images and upload failures preserve current pointer',async()=>{
  const previous=await pointer(owner);
  const bad=await save(A,a,Buffer.from('not an image'));assert.equal(bad.result.status,422);assert.equal(await pointer(owner),previous);
  await mode('upload-failure');const failed=await save(A,a,png);assert.equal(failed.result.status,503);await mode('off');assert.equal(await pointer(owner),previous);
 });
 await scenario('lost attachment response preserves confirmed photo',async()=>{
  const previous=await pointer(owner);await mode('attach-lost');const saved=await save(A,a,png);await mode('off');
  assert.equal(saved.result.status,200);assert.equal(saved.result.data.data.code,'saved');assert.notEqual(await pointer(owner),previous);
  assert.equal((await admin.storage.from('profile-photos').download(await pointer(owner))).error,null);
 });
 await scenario('cleanup failure retains retry work independently of save',async()=>{
  const old=await pointer(owner);await mode('delete-failure');const saved=await save(A,a,png);await mode('off');
  assert.equal(saved.result.status,200);assert.equal(saved.result.data.data.cleanupPending,true);assert.equal((await admin.storage.from('profile-photos').download(old)).error,null);
  await cleanup();assert.notEqual((await admin.storage.from('profile-photos').download(old)).error,null,'Old bytes removed after retry');
  assert.equal((await admin.storage.from('profile-photos').download(await pointer(owner))).error,null,'Current bytes retained');
 });
 await scenario('pending cleanup includes another worker owner claims',async()=>{
  const old=await pointer(owner);await mode('delete-failure');const saved=await save(A,a,png);await mode('off');assert.equal(saved.result.status,200);
  const claims=await rpc('claim_profile_photo_cleanup',{batch_size:20,cleanup_owner:owner.id});assert.ok(claims.some(c=>c.final_path===old));
  const removed=await call('/api/profile/photo',A,{method:'DELETE'});assert.equal(removed.status,200);assert.equal(removed.data.data.cleanupPending,true);
  assert.equal((await admin.storage.from('profile-photos').download(old)).error,null,'Another worker still owns old-file cleanup');
  await sql(`update public.profile_photo_objects set cleanup_until=clock_timestamp()-interval '1 second' where owner_id='${owner.id}';`);
  await cleanup();assert.notEqual((await admin.storage.from('profile-photos').download(old)).error,null);
 });
 await scenario('maximum bytes accepted, excess bytes rejected, MIME mismatch denied',async()=>{
  const maximum=Buffer.alloc(5000000);png.copy(maximum);
  const r=await reserve(A);assert.equal((await upload(a,r,maximum)).error,null);
  const accepted=await call('/api/profile/photo',A,{body:{reservation_id:r.reservationId}});assert.equal(accepted.status,200);assert.equal(accepted.data.data.code,'saved');
  const excess=await reserve(A);assert.notEqual((await upload(a,excess,Buffer.alloc(5000001))).error,null);
  await rpc('abandon_profile_photo',{reservation_id:excess.reservationId});await cleanup();
  const mismatch=await save(A,a,png,'image/jpeg');assert.equal(mismatch.result.status,422);
 });
 await scenario('membership revocation rejects retained session, cleanup still works',async()=>{
  const r=await reserve(A);assert.equal((await upload(a,r,png)).error,null);
  await stack.setMembership(owner.id,{role:'member',status:'disabled'});
  assert.equal((await call('/api/profile/photo',A,{body:{reservation_id:r.reservationId}})).status,403);
  assert.equal((await call('/api/profile/photo/uploads',A)).status,403);
  assert.notEqual((await a.storage.from('profile-photos').download(await pointer(owner))).error,null);
  await rpc('abandon_profile_photo',{reservation_id:r.reservationId});await cleanup();
  assert.notEqual((await admin.storage.from('profile-photo-uploads').download(r.sourcePath)).error,null);
  await stack.setMembership(owner.id,{role:'member',status:'active'});
 });
 await scenario('remove is idempotent and stale candidate cannot undo removal',async()=>{
  const r=await reserve(A);assert.equal((await upload(a,r,png)).error,null);
  const removal=await call('/api/profile/photo',A,{method:'DELETE'});assert.equal(removal.status,200);assert.equal(await pointer(owner),null);
  const stale=await call('/api/profile/photo',A,{body:{reservation_id:r.reservationId}});assert.equal(stale.status,409);assert.equal(await pointer(owner),null);
  assert.equal((await call('/api/profile/photo',A,{method:'DELETE'})).status,200);
 });
 await scenario('overlapping attach/remove serialize and cleanup claims cannot lose replaced finals',async()=>{
  const r=await reserve(A);assert.equal((await upload(a,r,png)).error,null);
  assert.equal((await a.rpc('begin_profile_photo_finalize',{reservation_id:r.reservationId})).data.code,'processing');
  const normalized=await sharp(png).webp().toBuffer(),key=`${owner.id}/${r.reservationId}.webp`;
  assert.equal((await admin.storage.from('profile-photos').upload(key,normalized,{contentType:'image/webp',upsert:false})).error,null);
  await rpc('mark_profile_photo_ready',{reservation_id:r.reservationId});
  const results=await Promise.all([a.rpc('attach_profile_photo',{reservation_id:r.reservationId}),a.rpc('remove_profile_photo')]);
  for(const result of results)assert.equal(result.error,null);
  assert.equal(await pointer(owner),null);
  if(results[0].data.code==='conflict')await rpc('abandon_profile_photo',{reservation_id:r.reservationId});
  await cleanup();
  assert.notEqual((await admin.storage.from('profile-photos').download(key)).error,null);
  // Hold a current-source cleanup claim, then remove its pointer.
  const held=await reserve(A);assert.equal((await upload(a,held,png)).error,null);
  assert.equal((await a.rpc('begin_profile_photo_finalize',{reservation_id:held.reservationId})).data.code,'processing');
  const heldKey=`${owner.id}/${held.reservationId}.webp`;
  assert.equal((await admin.storage.from('profile-photos').upload(heldKey,normalized,{contentType:'image/webp',upsert:false})).error,null);
  await rpc('mark_profile_photo_ready',{reservation_id:held.reservationId});
  assert.equal((await a.rpc('attach_profile_photo',{reservation_id:held.reservationId})).data.code,'saved');
  const claims=await rpc('claim_profile_photo_cleanup',{batch_size:20});const claim=claims.find(c=>c.id===held.reservationId);assert.ok(claim);assert.equal(claim.final_path,null);
  assert.equal((await a.rpc('remove_profile_photo')).data.code,'removed');
  assert.equal((await rpc('ack_profile_photo_cleanup',{reservation_id:claim.id,claim_token:claim.claim_token,source_deleted:true,final_deleted:true})).code,'conflict','Old source-only claim cannot erase new final cleanup work');
  await cleanup();assert.notEqual((await admin.storage.from('profile-photos').download(heldKey)).error,null);
 });
 await scenario('expiry and cleanup fence late privileged metadata commits',async()=>{
  const r=await reserve(A);
  await sql(`update public.profile_photo_objects set expires_at=clock_timestamp()-interval '1 second' where id='${r.reservationId}';`);
  assert.notEqual((await upload(a,r,png)).error,null);
  await cleanup();
  assert.notEqual((await admin.storage.from('profile-photo-uploads').upload(r.sourcePath,png,{contentType:'image/png',upsert:false})).error,null,'Even privileged late writes are fenced');
  assert.notEqual((await admin.storage.from('profile-photo-uploads').download(r.sourcePath)).error,null);
 });
 // Real overlapping uploads use a streamed request held after permission probing.
 await scenario('in-flight source and final uploads cannot resurrect acknowledged cleanup',async()=>{
  for(const [bucket,aborted] of [['profile-photo-uploads',false],['profile-photos',false],['profile-photos',true]]){
   const r=await reserve(A);
   if(bucket==='profile-photos')assert.equal((await a.rpc('begin_profile_photo_finalize',{reservation_id:r.reservationId})).data.code,'processing');
   const key=bucket==='profile-photos'?`${owner.id}/${r.reservationId}.webp`:r.sourcePath;
   const token=bucket==='profile-photos'?storageToken:(await a.auth.getSession()).data.session.access_token;
   const child=spawn('docker',['exec','-i',`supabase_storage_${stack.projectId}`,'node','-e',String.raw`
    const http=require('node:http'),readline=require('node:readline');let req,bytes;
    const lines=readline.createInterface({input:process.stdin});
    lines.on('line',line=>{
     if(!req){const input=JSON.parse(line);bytes=Buffer.from(input.bytes,'base64');req=http.request({hostname:'127.0.0.1',port:5000,path:'/object/'+input.bucket+'/'+input.key,method:'POST',headers:{authorization:'Bearer '+input.token,'content-type':input.mime,'x-upsert':'false','content-length':bytes.length}},res=>{res.resume();res.on('end',()=>{console.log('status:'+res.statusCode);process.exit(0);});});
      req.on('error',()=>{console.log('transport-error');process.exit(1);});req.write(bytes.subarray(0,64));
     }else if(line==='finish')req.end(bytes.subarray(64));else if(line==='abort')req.destroy();
    });
   `],{env:localProcessEnvironment(),stdio:['pipe','pipe','pipe'],timeout:20000});
   let output='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
   const request=new Promise(resolve=>{child.on('error',()=>resolve({code:1}));child.on('close',code=>resolve({code,output}));});
   child.stdin.write(JSON.stringify({bucket,key,token,mime:bucket==='profile-photos'?'image/webp':'image/png',bytes:png.toString('base64')})+'\n');
   // Observe a real partially written backend file before allowing cleanup.
   let observed=false;
   for(let i=0;i<100;i++){
    const files=await exec('docker',['exec',`supabase_storage_${stack.projectId}`,'find',backendRoot,'-type','f'],{env:localProcessEnvironment(),timeout:5000});
    if(files.stdout.includes(r.reservationId)){observed=true;break;}await delay(50);
   }
   assert.equal(observed,true,'In-flight backend write was not observed');
   await sql(`update public.profile_photo_objects set expires_at=clock_timestamp()-interval '1 second' where id='${r.reservationId}';`);
   await cleanup();child.stdin.end(aborted?'abort\n':'finish\n');
   const outcome=await request;
   if(aborted){assert.equal(outcome.code,1);assert.match(outcome.output,/transport-error/);}
   else{assert.equal(outcome.code,0,'Held Storage request must complete');assert.match(outcome.output,/status:(?:400|403)/,'Late metadata commit denied');}
   assert.notEqual((await admin.storage.from(bucket).download(key)).error,null,'No late readable object');
   let absent=false;
   for(let i=0;i<100;i++){
    const files=await exec('docker',['exec',`supabase_storage_${stack.projectId}`,'find',backendRoot,'-type','f'],{env:localProcessEnvironment(),timeout:5000});
    if(!files.stdout.includes(r.reservationId)){absent=true;break;}await delay(100);
   }
   assert.equal(absent,true,'Storage failed-upload cleanup removed physical backend version');
  }
 });
 stack.assertNoCredentialLeaks(app.diagnostics());for(const s of sessions)s.assertNoCredentialLeaks(app.diagnostics());
 console.log(`Profile photo verification: ${summary.passed} scenarios passed.`);
}catch(error){summary.failed++;summary.failedScenario=currentScenario;process.exitCode=1;console.error(`Profile photo verification failed: ${currentScenario}: ${error.message}`);}
finally{
 try{await app?.close();}catch{process.exitCode=1;}
 if(stack){
  try{await cleanup();await sql('delete from public.profile_photo_objects;delete from public.profiles;');}catch(error){process.exitCode=1;console.error('Owned photo row cleanup failed: '+error.message);}
  try{await stack.close();}catch{process.exitCode=1;console.error('Owned photo stack cleanup failed');}
 }
 await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'photo-summary.json'),JSON.stringify(summary,null,2)+'\n');
}
