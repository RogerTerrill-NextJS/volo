import assert from 'node:assert/strict';
import {test} from 'node:test';
import {cleanupRecoveryResources} from './helpers/database-recovery-cases.mjs';
function fixture(failure){
 const calls=[],source={id:'source'},target={id:'target',async close(){calls.push('close-target');if(failure==='target')throw Error('fixture target failure');}},app={async close(){calls.push('close-app');if(failure==='app')throw Error('fixture app failure');}};
 return {calls,ports:{app,target,source,artifactDirectory:'/private/owned-fixture',async clearFixtures(stack){calls.push('clear-'+stack.id);if(failure==='clear'&&stack===target)throw Error('fixture clear failure');},async removeArtifacts(){calls.push('remove-private-artifacts');}}};
}
test('successful recovery cleanup removes only its artifacts after closing app and target',async()=>{
 const f=fixture();await cleanupRecoveryResources(f.ports);assert.deepEqual(f.calls,['close-app','clear-target','clear-source','close-target','remove-private-artifacts']);
});
for(const failure of ['app','clear','target'])test('recovery cleanup continues all resource attempts and retains artifacts after '+failure+' failure',async()=>{
 const f=fixture(failure);await assert.rejects(cleanupRecoveryResources(f.ports),error=>error.operation==='recovery-cleanup'&&error.fixtureDiagnostic.includes('--cleanup --recovery'));
 assert.deepEqual(f.calls,['close-app','clear-target','clear-source','close-target']);
});
