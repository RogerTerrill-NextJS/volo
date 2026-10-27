import {messageInstant,messageUuid} from '../messages/validation.ts';
export type FlightOutcome={requestId:string;flightId:string;counterpartId:string;counterpartName:string|null;departureAt:string;departureTimezone:string;departureAirport:string;destinationAirport:string;isOwner:boolean;answer:boolean|null;revision:number;updatedAt:string|null};
const keys=['requestId','flightId','counterpartId','counterpartName','departureAt','departureTimezone','departureAirport','destinationAirport','isOwner','answer','revision','updatedAt'];
export function projectOutcome(raw:unknown):FlightOutcome|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const r=raw as Record<string,unknown>;
 if(Object.keys(r).length!==keys.length||Object.keys(r).some(k=>!keys.includes(k))||![r.requestId,r.flightId,r.counterpartId].every(v=>typeof v==='string'&&messageUuid.test(v))||typeof r.isOwner!=='boolean'||![null,true,false].includes(r.answer as null|boolean)||!Number.isSafeInteger(r.revision)||(r.revision as number)<0||(r.revision as number)>2147483647)return null;
 if(r.counterpartName!==null&&(typeof r.counterpartName!=='string'||!r.counterpartName.trim()||!r.counterpartName.isWellFormed()||r.counterpartName.includes('\u0000')||[...r.counterpartName].length>80))return null;
 if(![r.departureAirport,r.destinationAirport].every(v=>typeof v==='string'&&/^[A-Z0-9]{2,8}$/.test(v))||typeof r.departureTimezone!=='string'||!messageInstant(r.departureAt))return null;
 try{new Intl.DateTimeFormat('en-US',{timeZone:r.departureTimezone});}catch{return null;}
 if(r.answer===null?(r.revision!==0||r.updatedAt!==null):(r.revision===0||!messageInstant(r.updatedAt)))return null;
 return {...r,departureAt:messageInstant(r.departureAt)!,updatedAt:r.updatedAt===null?null:messageInstant(r.updatedAt)!} as FlightOutcome;
}
export type OutcomeInput={requestId:string;answer:boolean;expectedRevision:number};
export function parseOutcome(raw:unknown):OutcomeInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;const r=raw as Record<string,unknown>;
 if(Object.keys(r).length!==3||Object.keys(r).some(k=>!['request_id','answer','expected_revision'].includes(k))||typeof r.request_id!=='string'||!messageUuid.test(r.request_id.toLowerCase())||!['yes','no'].includes(String(r.answer))||typeof r.answer!=='string'||typeof r.expected_revision!=='string'||!/^(0|[1-9][0-9]{0,9})$/.test(r.expected_revision))return null;
 const expectedRevision=Number(r.expected_revision);if(expectedRevision>=2147483647)return null;
 return {requestId:r.request_id.toLowerCase(),answer:r.answer==='yes',expectedRevision};
}
