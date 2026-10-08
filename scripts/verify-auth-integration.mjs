import assert from 'node:assert/strict';
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {startLocalAuthStack,cleanupOwnedStack,evidenceDirectory} from '../tests/helpers/local-auth-stack.mjs';
import {signInSession} from '../tests/helpers/real-auth-session.mjs';
import {startRealAuthApp} from '../tests/helpers/real-auth-app.mjs';

const root=path.resolve(import.meta.dirname,'..');
const summary={commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),versions:{node:process.version,next:'16.3.8',supabaseCli:'2.119.0'},scenarios:[],limitations:['Local fixture headers do not prove Netlify CDN storage behavior (VOLO-120).','Hosted authenticated writes and browser history are not exercised.']};
let stack,app;const sessions=[];
const check=(condition,message)=>assert.ok(condition,message);
async function scenario(name,run){try{await run();summary.scenarios.push({name,status:'passed'});console.log(`PASS ${name}`);}catch{summary.scenarios.push({name,status:'failed'});throw new Error(`Integration scenario failed: ${name}`);}}
try{
  if(process.argv.includes('--cleanup')){await cleanupOwnedStack(root);}else{
    stack=await startLocalAuthStack({repositoryRoot:root});
    app=await startRealAuthApp({repositoryRoot:root,stack});
    const accounts={},users={};
    for(const [label,role,status] of [['A','member','active'],['B','member','active'],['admin','admin','active'],['disabled','member','disabled'],['absent',null,'active']]){
      accounts[label]=await stack.createAccount({label,role,status});users[label]=await signInSession(stack,accounts[label]);sessions.push(users[label]);
    }
    await scenario('admission',async()=>{
      for(const label of ['A','B','admin']){const response=await app.request('/api/subject',{session:users[label]});check(response.status===200,'admission status');const data=await response.json();check(data.userId===accounts[label].id,'admission subject');check(data.role===(label==='admin'?'admin':'member'),'admission role');}
      for(const label of ['disabled','absent']){const response=await app.request('/api/subject',{session:users[label]});check(response.status===403,'membership denial');}
      const anonymous=await app.request('/app');const body=await anonymous.text();
      check(anonymous.status===307?new URL(anonymous.headers.get('location'),app.origin).href===app.origin+'/login?reason=authentication-required':body.includes('/login?reason=authentication-required'),'fixed login destination');
      const before=app.effects().length;for(const transport of ['json','native','fetched'])await app.mutate(transport,{});check(app.effects().length===before,'anonymous effects');
    });
  }
}catch(error){console.error(error.message.startsWith('Integration scenario failed:')?error.message:'Real Auth integration failed during setup or cleanup; no credentials logged');process.exitCode=1;}
finally{
  try{await app?.close();}catch{process.exitCode=1;summary.scenarios.push({name:'fixture_cleanup',status:'failed'});}
  try{await stack?.close();}catch{process.exitCode=1;summary.scenarios.push({name:'stack_cleanup',status:'failed'});}
  if(!process.argv.includes('--cleanup')){await mkdir(evidenceDirectory(root),{recursive:true});await writeFile(path.join(evidenceDirectory(root),'summary.json'),JSON.stringify(summary,null,2)+'\n');}
}
