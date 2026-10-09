import assert from 'node:assert/strict';
import {test} from 'node:test';
import {invitationGenerationFormPolicy} from '../lib/auth/invitation-admin-form.ts';
const invitationId='30000000-0000-4000-8000-000000000001';
test('generation forms accept only canonical positive versions and preserve strict admin policies',()=>{
 for(const inspect of [false,true]){
  const policy=invitationGenerationFormPolicy(inspect);
  assert.deepEqual(policy.allowedRoles,['admin']);
  assert.deepEqual(policy.parse({invitationId,expectedVersion:'2'}),{ok:true,value:{invitationId,expectedVersion:2}});
  for(const expectedVersion of ['', '0','-1','01','1.0','1e2',' 2','2 ','Infinity','9007199254740991',2])assert.deepEqual(policy.parse({invitationId,expectedVersion}),{ok:false});
  for(const raw of [null,[],{}, {invitationId:'invalid',expectedVersion:'2'},{invitationId,expectedVersion:'2',role:'admin'},{invitationId,expectedVersion:'2',requesterId:invitationId}])assert.deepEqual(policy.parse(raw),{ok:false});
 }
});
