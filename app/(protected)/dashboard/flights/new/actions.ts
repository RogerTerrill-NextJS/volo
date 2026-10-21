'use server';
import {createFlight} from '../../../../../lib/flights/actions';
import {flightFormResult,type FlightFormState} from '../../../../../lib/flights/form-state';

export async function publishFlight(previous:FlightFormState,form:FormData):Promise<FlightFormState>{
 // This form publishes to NETWORK; visibility selection has its own ticket.
 form.set('visibility','NETWORK');
 const result=await createFlight(null,form);
 return flightFormResult(previous,form,result);
}
