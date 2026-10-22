export type InterestInput={flightId:string;introductoryNote:string|null};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parseInterestInput(raw:unknown):InterestInput|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return null;
 const input=raw as Record<string,unknown>;
 if(Object.keys(input).some(key=>!['flight_id','introductory_note'].includes(key))||typeof input.flight_id!=='string'||!uuid.test(input.flight_id))return null;
 const note=input.introductory_note;
 if(note!==undefined&&(typeof note!=='string'||Array.from(note).length>500))return null;
 return {flightId:input.flight_id.toLowerCase(),introductoryNote:typeof note==='string'&&note!==''?note:null};
}
