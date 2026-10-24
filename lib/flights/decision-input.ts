export type DecisionInput={flightId:string;requestId:string;decision:'accepted'|'declined'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseDecisionInput(raw:unknown):DecisionInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return null;
 const input=raw as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['flight_id','request_id','decision'].includes(key))
  ||typeof input.flight_id!=='string'||!uuid.test(input.flight_id)||typeof input.request_id!=='string'||!uuid.test(input.request_id)
  ||(input.decision!=='accepted'&&input.decision!=='declined'))return null;
 return {flightId:input.flight_id.toLowerCase(),requestId:input.request_id.toLowerCase(),decision:input.decision};
}
