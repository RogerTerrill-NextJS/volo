import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {messageUuid} from '../messages/validation.ts';
import {projectOutcome,type FlightOutcome} from './validation.ts';
export type OutcomePorts={access:()=>Promise<AccessResult>;read:(after:string|null)=>Promise<unknown>};
type Result={status:'authorized';rows:FlightOutcome[];nextCursor:string|null}|{status:'unauthenticated'|'forbidden'|'unavailable'|'invalid'};
function createPorts():OutcomePorts{return {access:async()=>(await import('../auth/access.ts')).getAccess(),async read(after){const client=await(await import('../flights/client.ts')).flightMutationClient();const r=await client.rpc('list_flight_outcomes',{p_after:after??undefined}).retry(false);if(r.error)throw Error('Outcomes unavailable');return r.data;}};}
function rows(raw:unknown,after:string|null,viewer:string):FlightOutcome[]{
 if(!Array.isArray(raw)||raw.length>21)throw Error('Invalid outcomes');let prior=after??'';
 return raw.map(value=>{const row=projectOutcome(value);if(!row||row.requestId<=prior||row.counterpartId===viewer)throw Error('Invalid outcomes');prior=row.requestId;return row;});
}
/** Ordinary-session, bounded own-answer projection; repeat eligibility after the first read. */
export async function listFlightOutcomes(after:unknown=undefined,ports:OutcomePorts=createPorts()):Promise<Result>{try{
 const before=await ports.access();if(before.status!=='authorized')return {status:before.status};
 if(after!==undefined&&(typeof after!=='string'||!messageUuid.test(after)))return {status:'invalid'};const cursor=typeof after==='string'?after:null;
 rows(await ports.read(cursor),cursor,before.member.userId);
 const current=rows(await ports.read(cursor),cursor,before.member.userId),final=await ports.access();
 if(final.status!=='authorized')return {status:final.status};if(final.member.userId!==before.member.userId)return {status:'forbidden'};
 return {status:'authorized',rows:current.slice(0,20),nextCursor:current.length>20?current[19].requestId:null};
}catch{return {status:'unavailable'};}}
