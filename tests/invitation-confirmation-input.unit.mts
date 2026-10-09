import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseConfirmationLink,readConfirmationCsrf} from '../lib/auth/invitation-confirmation-input.ts';
const secret=Buffer.alloc(32,3).toString('base64url');
test('only bounded exact invitation link inputs reach secret storage',()=>{
 assert.deepEqual(parseConfirmationLink(new URL('https://example.invalid/auth/confirm?token_hash=abc&type=invite&flow=invitation')),{tokenHash:'abc',type:'invite',resume:null});
 assert.deepEqual(parseConfirmationLink(new URL('https://example.invalid/auth/confirm?token_hash=abc&type=recovery&resume='+secret)),{tokenHash:'abc',type:'recovery',resume:secret});
 for(const query of ['token_hash=a&type=invite&type=invite','token_hash=a&type=invite&next=/dashboard','token_hash=a&type=recovery','token_hash=a&type=signup','type=invite','token_hash=a&type=invite&flow=recovery','token_hash=a&type=invite&resume=bad','token_hash='+('a'.repeat(257))+'&type=invite'])assert.equal(parseConfirmationLink(new URL('https://example.invalid/auth/confirm?'+query)),null);
});
test('CSRF form is bounded and rejects duplicate, authority and unsupported content',async()=>{
 const request=(body:string,type='application/x-www-form-urlencoded')=>new Request('https://example.invalid/auth/confirm',{method:'POST',headers:{'content-type':type},body});
 assert.equal(await readConfirmationCsrf(request('csrf='+secret)),secret);
 for(const body of ['csrf='+secret+'&csrf='+secret,'csrf='+secret+'&role=admin','csrf=bad','csrf='+secret+'&padding='+('a'.repeat(1024))])assert.equal(await readConfirmationCsrf(request(body)),null);
 assert.equal(await readConfirmationCsrf(request('csrf='+secret,'application/json')),null);
 const oversized=new Request('https://example.invalid',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(1025));c.close();}}),duplex:'half'} as RequestInit);
 assert.equal(await readConfirmationCsrf(oversized),null);
});
