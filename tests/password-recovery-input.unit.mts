import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readPasswordRecoveryInput} from '../lib/auth/password-recovery-input.ts';
const request=(body:string,headers:Record<string,string>={})=>new Request('https://preview.invalid/auth/recovery',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body});
test('recovery accepts only one normalized email without a caller destination',async()=>{
 assert.equal(await readPasswordRecoveryInput(request(new URLSearchParams({email:' Person+tag@example.invalid '}).toString())),'Person+tag@example.invalid');
 for(const body of ['email=bad','email=a@example.invalid&email=b@example.invalid','email=a@example.invalid&next=/dashboard','email=%FF','email=%no','x'.repeat(1025)])assert.equal(await readPasswordRecoveryInput(request(body)),null);
 for(const headers of [{'content-type':'application/json'},{'content-length':'1025'},{'content-length':'NaN'}] as Record<string,string>[])assert.equal(await readPasswordRecoveryInput(request('email=a@example.invalid',headers)),null);
});
test('recovery bounds chunked and stalled bodies before contacting Auth',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const input=(body:ReadableStream<Uint8Array>)=>new Request('https://preview.invalid/auth/recovery',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,duplex:'half'} as RequestInit);
 assert.equal(await readPasswordRecoveryInput(input(new ReadableStream({start(c){c.enqueue(new Uint8Array(1025));}}))),null);
 const pending=readPasswordRecoveryInput(input(new ReadableStream()));await Promise.resolve();t.mock.timers.tick(5001);assert.equal(await pending,null);t.mock.timers.reset();
});
