export type CancellationInput={flightId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseCancellationInput(raw:unknown):CancellationInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return null;
 const input=raw as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['flight_id','intent','confirmation'].includes(key))||input.intent!=='cancel'||input.confirmation!=='cancel'||typeof input.flight_id!=='string'||!uuid.test(input.flight_id))return null;
 return {flightId:input.flight_id.toLowerCase()};
}
