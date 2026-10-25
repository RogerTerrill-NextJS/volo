'use server';
import {redirect} from 'next/navigation';
import {handleActionMutation} from '../../../../../lib/auth/action-mutation';
import {conversationOpenPolicy} from '../../../../../lib/messages/open-mutation';
export type ContactState={revision:number;retry:boolean;message:string|null};
/** Every entry attempt independently checks origin, session and the current approved pair. */
export async function openConversation(previous:ContactState,form:FormData):Promise<ContactState>{
 const result=await handleActionMutation(form,conversationOpenPolicy(),1024);
 if(result.ok&&result.data.code==='opened')redirect(`/messages/${result.data.conversationId}`);
 const code=result.ok?result.data.code:result.code,retry=['unavailable','internal_error'].includes(code);
 return {revision:(typeof previous?.revision==='number'&&Number.isSafeInteger(previous.revision)?previous.revision:0)+1,retry,message:retry?'We could not open the conversation right now. Try again. Any existing conversation will be reused.':'Messaging is no longer available from this connection. Check its current status.'};
}
