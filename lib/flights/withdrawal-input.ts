export type WithdrawalInput={flightId:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseWithdrawalInput(raw:unknown):WithdrawalInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return null;
 const input=raw as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['flight_id','intent'].includes(key))||input.intent!=='withdraw'||typeof input.flight_id!=='string'||!uuid.test(input.flight_id))return null;
 return {flightId:input.flight_id.toLowerCase()};
}
