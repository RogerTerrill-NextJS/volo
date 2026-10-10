import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readCompletionInput,completionCsrf} from '../lib/auth/invitation-completion-input.ts';
const csrf='c'.repeat(64);
const request=(body:string,headers:Record<string,string>={})=>new Request('https://preview.invalid/account/complete',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',...headers},body});
const form=(p:string,q=p)=>new URLSearchParams({password:p,passwordConfirmation:q,csrf}).toString();
test('password input preserves exact characters and enforces Unicode and UTF8 limits',async()=>{
 for(const p of ['  abcdef','🙂'.repeat(8),'a'.repeat(256)])assert.deepEqual(await readCompletionInput(request(form(p))),{password:p,passwordConfirmation:p,csrf});
 for(const p of ['a'.repeat(7),'🙂'.repeat(7),'a'.repeat(257),'🙂'.repeat(65)])assert.equal(await readCompletionInput(request(form(p))),null);
 assert.equal(await readCompletionInput(request(form('abcdefgh','abcdefgH'))),null);
});
test('completion input rejects duplicated unknown malformed and oversized fields',async()=>{
 const valid=form('abcdefgh');
 for(const body of [valid+'&csrf='+csrf,valid+'&email=admin@example.invalid',valid.replace(csrf,'C'.repeat(64)),valid.replace('abcdefgh','%FFabcdefg'),valid.replace('abcdefgh','%no'),valid.slice(0,20),valid+'&'+ 'x'.repeat(4096)])assert.equal(await readCompletionInput(request(body)),null);
 for(const headers of [{'content-type':'application/json'},{'content-length':'4097'},{'content-length':'NaN'}] as Record<string,string>[])assert.equal(await readCompletionInput(request(valid,headers)),null);
});
test('chunked input and stalled bodies are bounded before any password work',async(t)=>{
 t.mock.timers.enable({apis:['setTimeout']});
 const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(4097));}});
 assert.equal(await readCompletionInput(new Request('https://preview.invalid',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body,duplex:'half'} as RequestInit)),null);
 const stall=new ReadableStream<Uint8Array>({}),pending=readCompletionInput(new Request('https://preview.invalid',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:stall,duplex:'half'} as RequestInit));await Promise.resolve();t.mock.timers.tick(5001);assert.equal(await pending,null);t.mock.timers.reset();
});
test('CSRF is domain separated from setup lookup authority',()=>{
 assert.equal(completionCsrf('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),'d2722b0db23932955699e227fcbb135191b5f226dc204f79fb498a6f230187fc');
});
