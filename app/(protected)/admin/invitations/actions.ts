'use server';
import {refresh} from 'next/cache';
import {handleActionMutation} from '../../../../lib/auth/action-mutation';
import {invitationIssuancePolicy} from '../../../../lib/auth/invitation-issuance';
import {invitationGenerationFormPolicy} from '../../../../lib/auth/invitation-admin-form';
import type {MutationResult} from '../../../../lib/auth/mutation';
import type {SendResult} from '../../../../lib/auth/invitation-send';

function present(result:MutationResult<SendResult>){
 if(!result.ok)return {message:result.message};
 const messages={accepted:'Accepted for sending. Delivery is not confirmed.',rejected:'Send failed. No successful send was confirmed.',conflict:'The invitation changed or cannot be sent. Refresh the list before trying again.',pending_reconciliation:'Needs review. Check send status; do not send another link while the outcome is uncertain.',unavailable:'Unable to complete the request. Check the list before trying again.'};
 refresh();
 return {message:messages[result.data.code]};
}
export async function sendInvitation(_previous:unknown,form:FormData){
 return present(await handleActionMutation(form,invitationIssuancePolicy()));
}
export async function renewInvitation(_previous:unknown,form:FormData){
 return present(await handleActionMutation(form,invitationGenerationFormPolicy()));
}
export async function inspectInvitation(_previous:unknown,form:FormData){
 return present(await handleActionMutation(form,invitationGenerationFormPolicy(true)));
}
