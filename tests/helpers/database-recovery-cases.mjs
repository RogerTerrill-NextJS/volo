import assert from 'node:assert/strict';
import {execFile,spawn,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import sharp from 'sharp';
import {startLocalAuthStack,reservePort,localProcessEnvironment,validateLocalApiUrl,sanitizeDiagnostics,evidenceDirectory} from './local-auth-stack.mjs';
import {startRealAuthApp} from './real-auth-app.mjs';
import {signInSession} from './real-auth-session.mjs';
const exec=promisify(execFile),digest=value=>createHash('sha256').update(value).digest('hex');
const applicationSchemas=['public','flight_private','directory_private','notification_private','deletion_private'];
const dataSchemas=[...applicationSchemas,'auth','storage'];
const quoted=value=>'"'+value.replaceAll('"','""')+'"';
export async function cleanupRecoveryResources({app,target,source,clearFixtures,removeArtifacts,artifactDirectory}){
 let failed=false;
 try{await app?.close();}catch{failed=true;}
 for(const stack of [target,source].filter(Boolean))try{await clearFixtures(stack);}catch{failed=true;}
 if(target)try{await target.close();}catch{failed=true;}
 if(failed){const error=new Error('Owned recovery cleanup incomplete');error.operation='recovery-cleanup';error.fixtureDiagnostic='Private recovery artifacts retained at '+artifactDirectory+'; use integration --cleanup --recovery for the registered projects';throw error;}
 await removeArtifacts();
}
export async function verifyDatabaseRecovery({source,repositoryRoot:root,signal,scenario}){
 const targetState=path.join(evidenceDirectory(root),'recovery-owned-target.json');
 const env=localProcessEnvironment(),artifacts=await mkdtemp(path.join(tmpdir(),'volo-recovery-'));let target,app,stage='ownership',photo,flight,request;
 const sourceAccounts=[],sessions=[],clients={};
 async function owned(stack,service='db'){
  assert.match(stack.projectId,/^volo-auth-[a-f0-9]{24}$/);validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
  const registered=JSON.parse(await readFile(stack===source?path.join(root,'.superpowers/sdd/2026-10-07-volo-119-auth-integration/owned-stack.json'):targetState,'utf8'));
  assert.equal(registered.projectId,stack.projectId);assert.equal(registered.workdir,stack.workdir);
  const name=`supabase_${service}_${stack.projectId}`;
  assert.equal((await exec('docker',['inspect','--format','{{ index .Config.Labels "com.supabase.cli.project" }}',name],{env})).stdout.trim(),stack.projectId,'Owned '+service+' container label');
  return name;
 }
 async function sql(stack,query){
  const container=await owned(stack);
  return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','supabase_admin','-d','postgres'],{env,timeout:120000,killSignal:'SIGKILL'});let out='',err='';
   child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);child.on('error',reject);child.on('close',code=>{if(code===0)resolve(out.trim());else{const error=new Error('Owned recovery SQL failed');error.operation='recovery-'+stage;error.fixtureDiagnostic=err.split('\n').find(line=>line.startsWith('ERROR:'))?.slice(0,300);reject(error);}});child.stdin.end("set timezone='UTC';\n"+query);
  });
 }
 const options=stack=>({auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(input,init)=>{assert.equal(new URL(typeof input==='string'?input:input.url??input).origin,stack.apiUrl);return fetch(input,init);}}});
 const checked=async query=>{const r=await query.retry(false);assert.equal(r.error,null,'Owned recovery fixture operation');return r.data;};
 const service=createClient(source.apiUrl,source.serverSecret,options(source));
 const safe=text=>{source.assertNoCredentialLeaks(text);target?.assertNoCredentialLeaks(text);for(const s of sessions)s.assertNoCredentialLeaks(text);};
 const manifestQuery=`select jsonb_build_object(
 'serverVersion',current_setting('server_version'),
 'relations',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'rls',c.relrowsecurity,'force',c.relforcerowsecurity,'acl',c.relacl::text) order by n.nspname,c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','flight_private','directory_private','notification_private','deletion_private') and c.relkind in('r','p','v','S')),
 'schemas',(select jsonb_agg(jsonb_build_object('name',nspname,'owner',pg_get_userbyid(nspowner),'acl',nspacl::text) order by nspname) from pg_namespace where nspname in('public','flight_private','directory_private','notification_private','deletion_private')),
 'enumTypes',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',t.typname,'labels',(select jsonb_agg(enumlabel order by enumsortorder) from pg_enum where enumtypid=t.oid)) order by n.nspname,t.typname) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='e' and n.nspname='public'),
 'defaultPrivileges',(select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',n.nspname,'type',d.defaclobjtype,'acl',d.defaclacl::text) order by pg_get_userbyid(d.defaclrole),n.nspname,d.defaclobjtype) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace),
 'columns',(select jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,'column',column_name,'type',udt_schema||'.'||udt_name,'nullable',is_nullable,'default',column_default) order by table_schema,table_name,ordinal_position) from information_schema.columns where table_schema in('public','flight_private','directory_private','notification_private','deletion_private')),
 'constraints',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.conname,'table',cl.relname,'definition',pg_get_constraintdef(c.oid)) order by n.nspname,cl.relname,c.conname) from pg_constraint c join pg_class cl on cl.oid=c.conrelid join pg_namespace n on n.oid=cl.relnamespace where n.nspname in('public','flight_private','directory_private','notification_private','deletion_private')),
 'indexes',(select jsonb_agg(jsonb_build_object('schema',schemaname,'name',indexname,'definition',indexdef) order by schemaname,indexname) from pg_indexes where schemaname in('public','flight_private','directory_private','notification_private','deletion_private')),
 'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p where schemaname in('public','auth','storage','flight_private','directory_private','notification_private','deletion_private')),
 'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,'definition',pg_get_functiondef(p.oid)) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','flight_private','directory_private','notification_private','deletion_private') and p.prokind='f'),
 'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by n.nspname,c.relname,t.tgname) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal and (n.nspname in('public','flight_private','directory_private','notification_private','deletion_private') or t.tgname='profile_photo_storage_write')),
 'publications',(select jsonb_agg(to_jsonb(p) order by pubname,schemaname,tablename) from pg_publication_tables p where pubname='supabase_realtime'),
 'publicationConfig',(select jsonb_agg(jsonb_build_object('name',pubname,'allTables',puballtables,'insert',pubinsert,'update',pubupdate,'delete',pubdelete,'truncate',pubtruncate)) from pg_publication where pubname='supabase_realtime'),
 'roles',(select jsonb_agg(jsonb_build_object('name',rolname,'super',rolsuper,'inherit',rolinherit,'login',rolcanlogin,'bypass',rolbypassrls) order by rolname) from pg_roles),
 'extensions',(select jsonb_agg(extname||':'||extversion order by extname) from pg_extension),
 'migrations',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'schedules',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'command',command,'database',database,'username',username,'active',active) order by jobname) from cron.job));`;
 async function dataHashes(stack,tables){const result={};for(const [schema,table] of tables){const value=await sql(stack,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${quoted(schema)}.${quoted(table)} t;`);result[schema+'.'+table]=digest(value);}return result;}
 async function clearFixtures(stack){
  const raw=await sql(stack,"select json_agg(tablename order by tablename) from pg_tables where schemaname='public';");const names=JSON.parse(raw)??[];
  if(names.length)await sql(stack,'truncate '+names.map(n=>'public.'+quoted(n)).join(',')+' cascade;');
 }
 try{
  await owned(source);stage='source-fixtures';await sql(source,'select cron.alter_job(jobid,active:=false) from cron.job;');await sql(source,await readFile(path.join(root,'supabase/seed.sql'),'utf8'));
  for(const [name,role] of [['owner','admin'],['joiner','member'],['disabled','member'],['outsider','admin']]){
   const account=await source.createAccount({label:'recovery-'+name,role});sourceAccounts.push(account);
   const c=clients[name]=createClient(source.apiUrl,source.publicKey,options(source));assert.equal((await c.auth.signInWithPassword({email:account.email,password:account.password})).error,null);
   await checked(service.from('profiles').insert({user_id:account.id,display_name:'Fictional recovery '+name,home_airport:'KPAO',pilot_designation:'licensed',bio:'Fictional snapshot biography'}));
  }
  const [owner,joiner,disabled]=sourceAccounts;
  await source.setMembership(disabled.id,{role:'member',status:'disabled'});
  flight=randomUUID();await checked(service.from('flights').insert({id:flight,owner_id:owner.id,departure_airport:'KPAO',destination_airport:'KSQL',departure_at:new Date(Date.now()+7*86400000).toISOString(),departure_timezone:'UTC',aircraft_description:'Fictional recovery aircraft',pilot_places:1,visibility:'PRIVATE'}));
  await checked(service.from('flight_recipients').insert({flight_id:flight,user_id:joiner.id}));
  request=(await checked(clients.joiner.rpc('submit_flight_interest',{p_flight_id:flight,p_introductory_note:'Fictional recovery interest'}))).requestId;
  await checked(clients.owner.rpc('decide_flight_request',{p_flight_id:flight,p_request_id:request,p_decision:'accepted'}));
  const conversation=await checked(clients.owner.rpc('get_or_create_flight_conversation',{p_request_id:request}));
  await checked(clients.joiner.rpc('send_conversation_message',{p_conversation_id:conversation,p_message_id:randomUUID(),p_body:'Fictional restored message'}));
  await checked(clients.joiner.rpc('submit_report',{p_report_id:randomUUID(),p_target_type:'flight',p_target_id:flight,p_reason:'Fictional recovery report'}));
  await sql(source,`alter table public.flights disable trigger flights_prepare;update public.flights set departure_at=now()-interval '2 days',departure_local_date=(now()-interval '2 days')::date where id='${flight}';alter table public.flights enable trigger flights_prepare;`);
  await checked(clients.owner.rpc('save_flight_outcome',{p_request_id:request,p_flew_together:true,p_expected_revision:0}));
  photo=await checked(clients.owner.rpc('reserve_profile_photo'));photo.final_path=owner.id+'/'+photo.id+'.webp';
  const png=await sharp({create:{width:8,height:8,channels:3,background:'white'}}).png().toBuffer(),webp=await sharp(png).webp().toBuffer();
  assert.equal((await clients.owner.storage.from('profile-photo-uploads').upload(photo.source_path,png,{contentType:'image/png'})).error,null);
  await checked(clients.owner.rpc('begin_profile_photo_finalize',{reservation_id:photo.id}));
  assert.equal((await service.storage.from('profile-photos').upload(photo.final_path,webp,{contentType:'image/webp'})).error,null);
  await checked(service.rpc('mark_profile_photo_ready',{reservation_id:photo.id}));await checked(clients.owner.rpc('attach_profile_photo',{reservation_id:photo.id}));
  stage='backup';const sourceManifest=await sql(source,manifestQuery),sourceMetrics=await checked(clients.owner.rpc('admin_mvp_metrics'));const started=Date.now();
  const cli=async args=>exec(process.execPath,[path.join(root,'node_modules/supabase/dist/supabase.js'),...args,'--workdir',source.workdir],{env,timeout:180000,maxBuffer:1024*1024});
  for(const [name,flags] of [['roles',['--role-only']],['schema',[]],['data',['--data-only','--use-copy','--schema',dataSchemas.join(','),'--exclude','storage.buckets_vectors,storage.vector_indexes']]]){
   stage='backup-'+name;const file=path.join(artifacts,name+'.sql');await writeFile(file,'',{mode:0o600,flag:'wx'});
   try{await cli(['db','dump','--local','--file',file,...flags]);}catch(cause){const error=new Error('Owned local backup command failed');error.operation='recovery-'+stage;error.fixtureDiagnostic=sanitizeDiagnostics(String(cause.stderr??''),[source.publicKey,source.serverSecret,...sourceAccounts.map(a=>a.password)]).replace(/postgres(?:ql)?:\/\/[^\s'"]+/g,'[redacted database URL]').slice(-1600);throw error;}
  }
  const schemaBackup=await readFile(path.join(artifacts,'schema.sql'),'utf8');assert.ok(schemaBackup.includes('flight_requests')&&schemaBackup.includes('admin_mvp_metrics'),'Logical schema reference contains application definitions');
  const data=await readFile(path.join(artifacts,'data.sql'),'utf8'),tables=[...data.matchAll(/^COPY "?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"? \(/gm)].map(m=>[m[1],m[2]]);
  console.log('Recovery backup shape: '+JSON.stringify({bytes:data.length,copyTables:tables.length,copyHeader:data.split('\n').find(line=>line.startsWith('COPY '))??'none',insertStatements:(data.match(/^INSERT INTO/gm)??[]).length}));assert.ok(tables.length>10,'Backup includes representative data tables');for(const [schema]of tables)assert.ok(dataSchemas.includes(schema),'Only approved local schemas');
  assert.ok(tables.some(([s,t])=>s==='auth'&&t==='users')&&tables.some(([s,t])=>s==='storage'&&t==='objects'),'Auth and Storage metadata included');
  const sourceHashes=await dataHashes(source,tables);stage='storage-backup';const storageSource=await owned(source,'storage');
  const storageSettings=async container=>{const inspect=JSON.parse((await exec('docker',['inspect',container],{env})).stdout)[0];return Object.fromEntries(inspect.Config.Env.map(s=>s.split(/=(.*)/s).slice(0,2)).filter(([key])=>['STORAGE_BACKEND','FILE_STORAGE_BACKEND_PATH','TENANT_ID'].includes(key)));};
  const storageConfig=await storageSettings(storageSource);console.log('Owned Storage backend settings: '+JSON.stringify(storageConfig));assert.equal(storageConfig.STORAGE_BACKEND,'file','Local Storage uses file backend');assert.ok(['/mnt','/var/lib/storage'].includes(storageConfig.FILE_STORAGE_BACKEND_PATH),'Recognized local Storage file root');
  // The pinned Storage image has BusyBox tar, which drops xattrs. Use its own
  // installed native metadata library to preserve bytes and every file attribute.
  const snapshotScript=`const fs=require('node:fs'),path=require('node:path'),x=require('/app/node_modules/fs-xattr');const root=process.argv[1],rows=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isDirectory())walk(file);else{if(!e.isFile())throw Error('Unsupported storage entry');rows.push({name:path.relative(root,file),bytes:fs.readFileSync(file).toString('base64'),attrs:x.listAttributesSync(file).map(name=>[name,x.getAttributeSync(file,name).toString('base64')])});}}}walk(root);process.stdout.write(JSON.stringify(rows));`;
  const storageArchive=await exec('docker',['exec',storageSource,'node','-e',snapshotScript,storageConfig.FILE_STORAGE_BACKEND_PATH],{env,encoding:'buffer',timeout:30000,maxBuffer:16*1024*1024});
  await writeFile(path.join(artifacts,'storage.json'),storageArchive.stdout,{mode:0o600,flag:'wx'});
  await checked(service.from('profiles').update({bio:'Fictional change AFTER backup'}).eq('user_id',owner.id));
  stage='target-start';const applicationOrigin=`http://127.0.0.1:${await reservePort()}`;
  target=await startLocalAuthStack({repositoryRoot:root,stateFile:targetState,signal,applicationOrigin});assert.notEqual(target.projectId,source.projectId);
  await sql(target,'select cron.alter_job(jobid,active:=false) from cron.job;');
  await scenario('recovery_pinned_schema_grants_hooks_and_fresh_target',async()=>{
   assert.equal(await sql(target,manifestQuery),sourceManifest,'Pinned schema, policies, grants, functions, roles, extensions, publications, schedules and migration history match');
   assert.equal(await sql(target,`select count(*) from auth.users where id='${owner.id}';`),'0','Target does not already contain source identity');
   assert.equal(await sql(target,"select retention_verified from deletion_private.policy;"),'f');
  });
  stage='restore';await owned(target);
  // COPY only into a schema whose full application manifest matched the backup.
  // The transaction-scoped replica setting bypasses row triggers only during import.
  await sql(target,'begin;set local session_replication_role=replica;truncate '+tables.map(([s,t])=>quoted(s)+'.'+quoted(t)).join(',')+' cascade;\n'+data+'\ncommit;');
  await scenario('recovery_logical_data_snapshot_and_authority_quarantine',async()=>{
   assert.deepEqual(await dataHashes(target,tables),sourceHashes,'Every copied table matches the backed-up point');
   assert.equal(await sql(target,`select bio from public.profiles where user_id='${owner.id}';`),'Fictional snapshot biography','Source-only change does not leak into backup recovery');
   assert.equal(await sql(target,'show session_replication_role;'),'origin','Normal trigger mode restored on next connection');
   // Replica-mode COPY bypasses FK triggers, so audit actual restored references.
   await sql(target,`do $audit$ declare k record; joins text; present text; missing bigint; begin
    for k in select c.conkey,c.confkey,c.conname,c.conrelid,c.confrelid,n.nspname child_schema,t.relname child_table,pn.nspname parent_schema,pt.relname parent_table from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace join pg_class pt on pt.oid=c.confrelid join pg_namespace pn on pn.oid=pt.relnamespace where c.contype='f' and n.nspname in('public','flight_private','directory_private','notification_private','deletion_private') loop
     select string_agg(format('c.%I=p.%I',a.attname,b.attname),' and '),string_agg(format('c.%I is not null',a.attname),' and ') into joins,present from unnest(k.conkey,k.confkey) ids(child_id,parent_id) join pg_attribute a on a.attrelid=k.conrelid and a.attnum=ids.child_id join pg_attribute b on b.attrelid=k.confrelid and b.attnum=ids.parent_id;
     execute format('select count(*) from %I.%I c where %s and not exists(select 1 from %I.%I p where %s)',k.child_schema,k.child_table,present,k.parent_schema,k.parent_table,joins) into missing;
     if missing<>0 then raise exception 'Restored foreign key invalid: %',k.conname; end if;
    end loop;
   end $audit$;`);
   assert.equal(await sql(target,'select count(*) from cron.job where active;'),'0','Schedulers remain quarantined');
   assert.equal(await sql(target,'select retention_verified from deletion_private.policy;'),'f','Deletion enablement remains default-off');
  });
  stage='storage';const restoredClient=createClient(target.apiUrl,target.publicKey,options(target));assert.equal((await restoredClient.auth.signInWithPassword({email:owner.email,password:owner.password})).error,null);
  await scenario('recovery_storage_metadata_gap_and_separate_local_bytes',async()=>{
   assert.equal(await sql(target,`select count(*) from storage.objects where bucket_id='profile-photos' and name='${photo.final_path}';`),'1');
   assert.ok((await restoredClient.storage.from('profile-photos').download(photo.final_path)).error,'Database restore alone has no file bytes');
   const storageTarget=await owned(target,'storage');assert.deepEqual(await storageSettings(storageTarget),storageConfig,'Local file-backend namespace matches');
   const restoreScript=`const fs=require('node:fs'),path=require('node:path'),x=require('/app/node_modules/fs-xattr');const root=process.argv[1];for(const row of JSON.parse(fs.readFileSync(0,'utf8'))){const file=path.resolve(root,row.name);if(!file.startsWith(root+'/'))throw Error('Invalid storage entry');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,Buffer.from(row.bytes,'base64'));for(const [name,value]of row.attrs)x.setAttributeSync(file,name,Buffer.from(value,'base64'));}`;
   const unpack=spawnSync('docker',['exec','-i',storageTarget,'node','-e',restoreScript,storageConfig.FILE_STORAGE_BACKEND_PATH],{env,input:await readFile(path.join(artifacts,'storage.json')),timeout:30000,maxBuffer:1024*1024});
   assert.equal(unpack.status,0,'Local Storage snapshot restores bytes and extended metadata');
   const restored=await restoredClient.storage.from('profile-photos').download(photo.final_path);assert.equal(restored.error,null);assert.equal(restored.data.type,'image/webp','Restored final photo content type is preserved');assert.equal(digest(Buffer.from(await restored.data.arrayBuffer())),digest(webp),'Current final photo bytes restored exactly');
   const original=await restoredClient.storage.from('profile-photo-uploads').download(photo.source_path);
   // Source uploads are owner/write-only by policy; verify their bytes with the scoped privileged client.
   assert.ok(original.error,'Restored ordinary reads do not broaden source-object policy');
   const privileged=createClient(target.apiUrl,target.serverSecret,options(target)),sourceObject=await privileged.storage.from('profile-photo-uploads').download(photo.source_path);assert.equal(sourceObject.error,null);assert.equal(digest(Buffer.from(await sourceObject.data.arrayBuffer())),digest(png));
  });
  stage='app';app=await startRealAuthApp({repositoryRoot:root,stack:target,signal,applicationOrigin,memberAdmin:true,flights:true,photos:true});
  await scenario('recovery_real_auth_and_compiled_app_smoke',async()=>{
   const ownerSession=await signInSession(target,owner),disabledSession=await signInSession(target,disabled);sessions.push(ownerSession,disabledSession);
   const response=await app.request('/api/metrics',{session:ownerSession});assert.match(response.headers.get('cache-control')??'',/no-store/);const report=await response.json();assert.equal(report.status,'authorized','Restored app metric authorization');
   const {asOf:oldTime,...before}=sourceMetrics,{asOf:newTime,...after}=report.report;assert.ok(oldTime&&newTime);assert.deepEqual(after,before,'Actual app reads restored aggregate source');
   const outcomes=await(await app.request('/dashboard/outcomes',{session:ownerSession})).text();safe(outcomes);assert.ok(outcomes.includes('Fictional recovery joiner')&&outcomes.includes('Your saved answer:'));
   const denied=await(await app.request('/api/metrics',{session:disabledSession})).json();assert.equal(denied.status,'forbidden','Restored disabled membership remains denied');
   const deniedPage=await(await app.request('/dashboard/outcomes',{session:disabledSession})).text();safe(deniedPage);assert.ok(deniedPage.includes('Access denied')&&!deniedPage.includes('Fictional recovery joiner'),'Disabled account loses ordinary protected reads, not only admin metrics');
   const outsider=createClient(target.apiUrl,target.publicKey,options(target)),outsideAccount=sourceAccounts[3];assert.equal((await outsider.auth.signInWithPassword({email:outsideAccount.email,password:outsideAccount.password})).error,null);
   assert.deepEqual(await checked(outsider.from('messages').select('id').eq('conversation_id',conversation)),[],'Restored RLS does not grant an unrelated admin private messages');
   assert.equal(await checked(outsider.rpc('get_flight_connection',{p_request_id:request})),null);assert.equal(await checked(outsider.rpc('get_flight_outcome',{p_request_id:request})),null);
   const photoResponse=await app.request('/api/profiles/'+owner.id+'/photo',{session:ownerSession});assert.equal(photoResponse.status,200,'Restored current photo HTTP status '+photoResponse.status);assert.match(photoResponse.headers.get('cache-control')??'',/no-store/);assert.equal(digest(Buffer.from(await photoResponse.arrayBuffer())),digest(webp),'Restored app photo bytes match backup');
  });
  const evidence={method:'exact-migration rebuild plus CLI logical data restore',tables:tables.length,migrations:JSON.parse(sourceManifest).migrations.length,schemaSha256:digest(sourceManifest),backupFiles:await Promise.all(['roles','schema','data'].map(async name=>({name:name+'.sql',sha256:digest(await readFile(path.join(artifacts,name+'.sql')))}))),elapsedSeconds:Math.ceil((Date.now()-started)/1000),storage:'separate local file snapshot preserving extended metadata; PNG/WebP hashes and WebP content type match',schedulers:'inactive',deletionEnablement:false};
  await writeFile(path.join(root,'.superpowers/sdd/2026-10-07-volo-119-auth-integration/recovery-summary.json'),JSON.stringify(evidence,null,2)+'\n');console.log(`Recovery verified: ${evidence.tables} data tables, ${evidence.migrations} migrations; owned local artifacts only`);
 }catch(error){error.operation??='recovery-'+stage;if(error.code==='ERR_ASSERTION')error.fixtureDiagnostic=error.message.split('\n')[0];throw error;}finally{
  await cleanupRecoveryResources({app,target,source,clearFixtures,removeArtifacts:()=>rm(artifacts,{recursive:true,force:true}),artifactDirectory:artifacts});
 }
}
