import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runDeletionStep} from '../lib/deletion/runner.mjs';
const request='22700000-0000-4000-8000-000000000051',subject='22700000-0000-4000-8000-000000000002';
const snapshot={requestId:request,subjectId:subject,phase:'photos',ready:true,assets:[]};
test('photo drain and rejected admin status prevent external effects',async()=>{
 let effects=0;assert.deepEqual(await runDeletionStep(request,{status:async()=>({...snapshot,ready:false}),cleanup:async()=>{effects++;}}),{code:'waiting_for_photo_drain'});
 await assert.rejects(runDeletionStep(request,{status:async()=>{throw Error('revoked');},deleteAuth:async()=>{effects++;}}));assert.equal(effects,0);
});
test('photo inventory can delete only validated owner-scoped assets; failures remain resumable',async()=>{
 for(const path of ['other/file','../file',subject+'/../file',subject+'/file\\escape',subject+'//file']){
  let effects=0;await assert.rejects(runDeletionStep(request,{status:async()=>({...snapshot,assets:[{bucket:'profile-photos',path}]}),cleanup:async()=>{},removeObjects:async()=>{effects++;}}));assert.equal(effects,0);
 }
 let finished=0;await assert.rejects(runDeletionStep(request,{status:async()=>({...snapshot,assets:[{bucket:'profile-photos',path:subject+'/orphan.webp'}]}),cleanup:async()=>{},removeObjects:async()=>{throw Error('lost');},finishPhotos:async()=>{finished++;}}));assert.equal(finished,0);
});
test('ambiguous Auth deletion is read back on retry without deleting again; complete needs confirmed subject',async()=>{
 let deleted=false,sends=0,complete=0;
 const ports={status:async()=>({...snapshot,phase:'auth'}),authUser:async()=>({id:subject,deleted_at:deleted?'2026-10-26':null}),deleteAuth:async()=>{deleted=true;sends++;throw Error('lost response');},complete:async()=>{complete++;return {code:'retention_pending'};}};
 await assert.rejects(runDeletionStep(request,ports));assert.equal(complete,0);
 assert.deepEqual(await runDeletionStep(request,ports),{code:'retention_pending'});assert.equal(sends,1);assert.equal(complete,1);
 await assert.rejects(runDeletionStep(request,{...ports,authUser:async()=>({id:request,deleted_at:'yes'})}));
});
