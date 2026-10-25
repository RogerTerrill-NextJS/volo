'use server';
import {randomUUID} from 'node:crypto';
import {refresh} from 'next/cache';
import {sendMessage} from '../../../../lib/messages/actions';
import {composerResult,type ComposerState} from '../../../../lib/messages/composer-state';
export async function sendChatMessage(previous:ComposerState,form:FormData):Promise<ComposerState>{
 const result=await sendMessage(null,form),state=composerResult(previous,form,result,randomUUID());
 if(state.status==='sent')refresh();
 return state;
}
