import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readLoginInput} from '../lib/auth/login-input.ts';
const request=(body:string,headers:Record<string,string>={})=>new Request('https://preview.invalid/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body});
const form=(password:string,email=' Person+tag@example.invalid ')=>new URLSearchParams({email,password}).toString();
test('login normalizes email whitespace while preserving exact password characters',async()=>{
 for(const password of ['x','  password  ','🙂'.repeat(64)])assert.deepEqual(await readLoginInput(request(form(password))),{email:'Person+tag@example.invalid',password});
 for(const password of ['', '🙂'.repeat(65),'a'.repeat(257)])assert.equal(await readLoginInput(request(form(password))),null);
});
test('login rejects duplicate, unknown, malformed and oversized form inputs',async()=>{
 const valid=form('password');
 for(const body of [valid+'&email=other@example.invalid',valid+'&next=https://foreign.invalid',valid.replace('password','%FF'),valid.replace('password','%no'),form('password','bad-email'),'x'.repeat(4097)])assert.equal(await readLoginInput(request(body)),null);
 for(const headers of [{'content-type':'application/json'},{'content-length':'4097'},{'content-length':'NaN'}] as Record<string,string>[])assert.equal(await readLoginInput(request(valid,headers)),null);
});
test('login bounds chunked and stalled bodies before authentication',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const input=(body:ReadableStream<Uint8Array>)=>new Request('https://preview.invalid/auth/login',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,duplex:'half'} as RequestInit);
 assert.equal(await readLoginInput(input(new ReadableStream({start(c){c.enqueue(new Uint8Array(4097));}}))),null);
 const pending=readLoginInput(input(new ReadableStream()));await Promise.resolve();t.mock.timers.tick(5001);assert.equal(await pending,null);t.mock.timers.reset();
});
