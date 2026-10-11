import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseConfirmationLink} from '../lib/auth/invitation-confirmation-input.ts';
import {newConfirmationSecret,confirmationDigest,sealConfirmation,openConfirmation} from '../lib/auth/invitation-confirmation-crypto.ts';

test('ordinary recovery requires its own explicit marker and excludes invitation proof',()=>{
 const link=(query:string)=>parseConfirmationLink(new URL('https://app.example.invalid/auth/confirm?'+query));
 assert.deepEqual(link('flow=recovery&type=recovery&token_hash=provider_hash'),{tokenHash:'provider_hash',type:'recovery',resume:null,flow:'recovery'});
 for(const query of ['type=recovery&token_hash=provider_hash','flow=recovery&type=invite&token_hash=provider_hash','flow=recovery&type=recovery&token_hash=provider_hash&resume='+newConfirmationSecret(),'flow=recovery&type=recovery&token_hash=provider_hash&next=/dashboard','flow=recovery&flow=invitation&type=recovery&token_hash=provider_hash'])assert.equal(link(query),null);
});
test('encrypted confirmation preserves ordinary recovery purpose and binding',()=>{
 process.env.VOLO_CONFIRMATION_KEYS=JSON.stringify({active:'test',keys:{test:Buffer.alloc(32,3).toString('base64')}});
 const binding={lookupDigest:confirmationDigest(newConfirmationSecret()),origin:'https://app.example.invalid',expiresAt:new Date(Date.now()+60000).toISOString()};
 const payload={tokenHash:'provider_hash',type:'recovery' as const,resume:null,csrf:newConfirmationSecret(),flow:'recovery' as const};
 const envelope=sealConfirmation(payload,binding);
 assert.deepEqual(openConfirmation(envelope,binding),payload);
 assert.equal(openConfirmation(envelope,{...binding,origin:'https://foreign.invalid'}),null);
});
