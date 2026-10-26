'use server';
import {submitReport} from '../../../lib/reports/actions';
import {reportFormResult,type ReportFormState} from '../../../lib/reports/form-state';
export async function sendReport(previous:ReportFormState,form:FormData):Promise<ReportFormState>{
 return reportFormResult(previous,form,await submitReport(null,form));
}
