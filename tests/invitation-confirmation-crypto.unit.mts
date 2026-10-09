import assert from 'node:assert/strict';
import {test} from 'node:test';
import {newConfirmationSecret,confirmationDigest,sealConfirmation,openConfirmation} from '../lib/auth/invitation-confirmation-crypto.ts';
const key=Buffer.alloc(32,7).toString('base64'),second=Buffer.alloc(32,9).toString('base64');
const config=()=>{process.env.VOLO_CONFIRMATION_KEYS=JSON.stringify({active:'one',keys:{one:key}});};
const binding={lookupDigest:'a'.repeat(64),origin:'https://preview.example.invalid',expiresAt:'2099-01-01T00:00:00.000Z'};
const payload={tokenHash:'provider_secret_canary',type:'invite' as const,resume:null,csrf:Buffer.alloc(32,1).toString('base64url')};
test('authenticated transport roundtrips without plaintext and binds origin, lookup and expiry',()=>{
 config();const envelope=sealConfirmation(payload,binding);assert.deepEqual(openConfirmation(envelope,binding),payload);
 assert.ok(!JSON.stringify(envelope).includes(payload.tokenHash));assert.notEqual(sealConfirmation(payload,binding).nonce,envelope.nonce);
 for(const changed of [{...binding,origin:'https://foreign.invalid'},{...binding,lookupDigest:'b'.repeat(64)},{...binding,expiresAt:'2099-01-02T00:00:00.000Z'}])assert.equal(openConfirmation(envelope,changed),null);
 for(const changed of [{...envelope,tag:Buffer.alloc(16).toString('base64url')},{...envelope,ciphertext:'A'.repeat(10000)},{...envelope,nonce:'bad'},{...envelope,keyId:'missing'}])assert.equal(openConfirmation(changed,binding),null);
});
test('key rotation reads retiring envelopes and encrypts only with the active key',()=>{
 config();const old=sealConfirmation(payload,binding);process.env.VOLO_CONFIRMATION_KEYS=JSON.stringify({active:'two',keys:{one:key,two:second}});
 assert.deepEqual(openConfirmation(old,binding),payload);assert.equal(sealConfirmation(payload,binding).keyId,'two');
 process.env.VOLO_CONFIRMATION_KEYS=JSON.stringify({active:'two',keys:{two:second}});assert.equal(openConfirmation(old,binding),null);
});
test('malformed keys and expired transport fail without disclosing configured material',()=>{
 for(const value of [undefined,'bad',JSON.stringify({active:'one',keys:{one:'secret_configuration_canary'}}),JSON.stringify({active:'absent',keys:{one:key}}),JSON.stringify({active:'one',keys:{one:key,two:second,three:key}})]){
  if(value===undefined)delete process.env.VOLO_CONFIRMATION_KEYS;else process.env.VOLO_CONFIRMATION_KEYS=value;
  assert.throws(()=>sealConfirmation(payload,binding),error=>error instanceof Error&&!error.message.includes('canary')&&!error.message.includes(key));
 }
 config();const expired={...binding,expiresAt:'2000-01-01T00:00:00.000Z'};assert.equal(openConfirmation(sealConfirmation(payload,expired),expired),null);
});
test('opaque transport credentials are canonical random 256-bit values with digest-only lookup',()=>{
 const a=newConfirmationSecret(),b=newConfirmationSecret();assert.match(a,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(a,b);assert.equal(Buffer.from(a,'base64url').length,32);
 assert.equal(confirmationDigest('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
