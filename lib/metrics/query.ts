import 'server-only';
import type {AccessResult} from '../auth/access.ts';
import {messageInstant} from '../messages/validation.ts';
export const metricKeys=['invitedPilots','activatedPilots','activeMembers','completedProfiles','activeProfiles','flightPosts','interestRequests','currentAcceptedRequests','recordedAcceptedRequests','messages','messagingConversations','outcomeResponses','confirmedConnections','oneParticipantConfirmed','bothParticipantsConfirmed','conflictingConnections'] as const;
export type MetricsReport=Record<typeof metricKeys[number],number>&{asOf:string;outcomes:'participant_reported'};
export type MetricsPorts={access:()=>Promise<AccessResult>;read:()=>Promise<unknown>};
type Result={status:'authorized';report:MetricsReport}|{[S in 'unauthenticated'|'forbidden'|'unavailable']:{status:S}}['unauthenticated'|'forbidden'|'unavailable'];
function createPorts():MetricsPorts{return {
 access:async()=>(await import('../auth/access.ts')).getAccess(),
 async read(){const client=await(await import('../flights/client.ts')).flightMutationClient();const r=await client.rpc('admin_mvp_metrics').retry(false);if(r.error)throw Error('Metrics unavailable');return r.data;},
};}
/** Fixed aggregate DTO only, with fresh admin role/status checks at both boundaries. */
export async function getMvpMetrics(ports:MetricsPorts=createPorts()):Promise<Result>{try{
 const before=await ports.access();if(before.status!=='authorized')return {status:before.status};if(before.member.role!=='admin')return {status:'forbidden'};
 const raw=await ports.read();if(!raw||typeof raw!=='object'||Array.isArray(raw))return {status:'unavailable'};
 const row=raw as Record<string,unknown>,asOf=messageInstant(row.asOf);
 if(!asOf||row.outcomes!=='participant_reported'||Object.keys(row).some(key=>!['asOf','outcomes',...metricKeys].includes(key))||metricKeys.some(key=>!Number.isSafeInteger(row[key])||(row[key] as number)<0))return {status:'unavailable'};
 const report={asOf,outcomes:'participant_reported',...Object.fromEntries(metricKeys.map(key=>[key,row[key]]))} as MetricsReport;
 const after=await ports.access();if(after.status!=='authorized')return {status:after.status};if(after.member.role!=='admin'||after.member.userId!==before.member.userId)return {status:'forbidden'};
 return {status:'authorized',report};
}catch{return {status:'unavailable'};}}
