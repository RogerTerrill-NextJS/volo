import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {startMutationFixture} from './helpers/mutation-fixture.mjs';

// A second parallel fixture must not acquire the first fixture's application
// port during its build and accidentally receive the first one's readiness probes.
test('mutation fixture owns its port throughout the build and releases it on close',{timeout:120000},async()=>{
 const intruder=createServer((_req,res)=>res.end('Wrong fixture'));
 let fixture;
 try{
  fixture=await startMutationFixture({directoryQuery:true,beforeStart:async({origin})=>{
   intruder.listen(Number(new URL(origin).port),'127.0.0.1');
   await assert.rejects(once(intruder,'listening'),{code:'EADDRINUSE'});
  }});
  assert.match((await fixture.request('/')).body,/Mutation fixture ready/);
  assert.deepEqual(fixture.backend.unexpected,[]);
  const port=Number(new URL(fixture.origin).port);
  await fixture.close();fixture=null;
  intruder.listen(port,'127.0.0.1');await once(intruder,'listening');
 }finally{
  if(fixture)await fixture.close();
  if(intruder.listening)await new Promise(resolve=>intruder.close(resolve));
 }
});

// Even the short close/spawn handoff can lose a port. Never let another
// listener's HTTP 200 stand in for this child successfully binding its socket.
test('fixture readiness never probes a competing server during restart',{timeout:120000},async()=>{
 const fixture=await startMutationFixture();
 let probes=0;
 const intruder=createServer((_req,res)=>{probes++;res.end('Wrong fixture');});
 try{
  const port=Number(new URL(fixture.origin).port);
  const takeover=async()=>{
   for(let i=0;i<1000;i++){
    intruder.listen(port,'127.0.0.1');
    try{await once(intruder,'listening');return;}catch(error){
     if(error.code!=='EADDRINUSE')throw error;
     await new Promise(resolve=>setTimeout(resolve,1));
    }
   }
   assert.fail('Competing listener never acquired the stopped app port');
  };
  await Promise.all([takeover(),assert.rejects(fixture.start(),/Mutation server exited/)]);
  assert.equal(probes,0,'Readiness requests must wait for this child to bind');
 }finally{
  await fixture.close();
  if(intruder.listening)await new Promise(resolve=>intruder.close(resolve));
 }
});
