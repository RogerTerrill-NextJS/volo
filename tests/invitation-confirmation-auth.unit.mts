import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {SupabaseClient} from '@supabase/supabase-js';
import {verifyConfirmationSession} from '../lib/auth/invitation-confirmation-auth.ts';
const subject='22000000-0000-4000-8000-000000000001',session='55000000-0000-4000-8000-000000000001';
test('setup binding requires verified claims and a matching fresh provider user',async()=>{
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fixture';
 const claims={sub:subject,session_id:session,iss:'https://example.supabase.co/auth/v1',aud:'authenticated',exp:Math.floor(Date.now()/1000)+60,is_anonymous:false};
 const user={id:subject,email:'Person@example.invalid',is_anonymous:false,email_confirmed_at:'2026-01-01'};
 const client=(changes:object={},userChanges:object={},error=false)=>({auth:{async getClaims(){return {data:{claims:{...claims,...changes}},error:error?new Error('provider_secret_canary'):null};},async getUser(){return {data:{user:{...user,...userChanges}},error:null};}}} as unknown as SupabaseClient);
 assert.deepEqual(await verifyConfirmationSession(client(),'verified-token'),{code:'verified',identity:{subject,email:'Person@example.invalid',sessionId:session}});
 for(const changes of [{session_id:undefined},{sub:'wrong'},{iss:'https://foreign.invalid/auth/v1'},{aud:'anon'},{exp:1},{is_anonymous:true}])assert.deepEqual(await verifyConfirmationSession(client(changes),'token'),{code:'denied'});
 for(const changes of [{id:'other'},{email:null},{is_anonymous:true},{email_confirmed_at:null}])assert.deepEqual(await verifyConfirmationSession(client({},changes),'token'),{code:'denied'});
 assert.deepEqual(await verifyConfirmationSession(client({}, {},true),'token'),{code:'denied'});
});
