import {validateFlightForCreation,type FlightFields,type FlightValidation} from './validation.ts';
export type EditInput={flightId:string;expectedUpdatedAt:string;value:FlightFields};
export type EditValidation={ok:true;input:EditInput}|Extract<FlightValidation,{ok:false}>;
export function normalizeEditInstant(raw:unknown):string|null{
 if(typeof raw!=='string')return null;
 const m=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(raw);if(!m)return null;
 const value=`${m[1]}.${(m[2]??'').padEnd(6,'0')}Z`,date=new Date(value);
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,19)===m[1]?value:null;
}
export function validateEditInput(raw:unknown,now=Date.now()):EditValidation{
 const invalid:EditValidation={ok:false,fieldErrors:{},message:'Reload this flight and check the edit fields.'};
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))return invalid;
 const {flight_id,expected_updated_at,...fields}=raw as Record<string,unknown>,expected=normalizeEditInstant(expected_updated_at);
 if(typeof flight_id!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(flight_id)||!expected||Object.keys(fields).some(key=>!['departure_airport','destination_airport','departure_local_date','departure_local_time','departure_timezone','departure_occurrence','aircraft_description','pilot_places','notes'].includes(key)))return invalid;
 const validated=validateFlightForCreation({...fields,visibility:'NETWORK'},now);
 return validated.ok?{ok:true,input:{flightId:flight_id.toLowerCase(),expectedUpdatedAt:expected,value:validated.value}}:validated;
}
