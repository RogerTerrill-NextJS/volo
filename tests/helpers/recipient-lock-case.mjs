import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {localProcessEnvironment,validateLocalApiUrl} from './local-auth-stack.mjs';
const exec=promisify(execFile);

// Only the owned creation-case subjects/flight are supplied. No arbitrary SQL API.
export async function verifyRecipientLock({stack,flightId,ownerId,recipientId}){
 validateLocalApiUrl(stack.apiUrl,Number(new URL(stack.apiUrl).port));
 for(const id of [flightId,ownerId,recipientId])assert.match(id,/^[a-f0-9-]{36}$/);
 assert.ok((await readFile(stack.workdir+'/supabase/config.toml','utf8')).includes(`project_id = "${stack.projectId}"`));
 const container='supabase_db_'+stack.projectId,env=localProcessEnvironment();
 assert.equal(execFileSync('docker',['inspect','--format','{{ index .Config.Labels "com.supabase.cli.project" }}',container],{env,encoding:'utf8'}).trim(),stack.projectId);
 const command=['exec',container,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c'];
 const sql=query=>exec('docker',[...command,query],{env,timeout:15000,maxBuffer:1024*1024});
 const label='volo-recipient-'+randomUUID();
 const change=selected=>`select public.change_flight_recipient('${flightId}','${recipientId}',${selected});`;
 const transaction=(suffix,body)=>`begin; set local application_name='${label+suffix}'; set local role authenticated; select set_config('request.jwt.claims','{"sub":"${ownerId}","role":"authenticated"}',true); ${body} commit;`;
 async function waitFor(suffix,condition){
  for(let i=0;i<60;i++){
   const result=await sql(`select count(*) from pg_stat_activity where application_name='${label+suffix}' and ${condition};`);
   if(result.stdout.trim()==='1')return;
   await delay(50);
  }
  throw Error('Owned recipient lock barrier was not observed');
 }
 const first=sql(transaction('-first',change(true)+'select pg_sleep(5);'));
 void first.catch(()=>{});
 // Observe settlement in finally as well, so a failed barrier cannot leak locks.
 let second;
 try{
  await waitFor('-first',"wait_event='PgSleep'");
  second=sql(transaction('-second',change(false)));
  void second.catch(()=>{});
  await waitFor('-second',"wait_event_type='Lock'");
  await Promise.all([first,second]);
 }finally{await Promise.allSettled([first,...(second?[second]:[])]);}
}
