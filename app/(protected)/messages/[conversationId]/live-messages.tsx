'use client';
import {useEffect,useState} from 'react';
import {useRouter} from 'next/navigation';
import {createBrowserSupabaseClient} from '../../../../lib/supabase/client';
import {watchConversation,type LiveState} from '../../../../lib/messages/realtime';
import {useConversationDraft} from './draft';
export default function LiveMessages({conversationId,viewerId}:{conversationId:string;viewerId:string}){
 const {clear}=useConversationDraft(),router=useRouter(),[status,setStatus]=useState<LiveState>('connecting');
 useEffect(()=>{
  const watcher=watchConversation({client:createBrowserSupabaseClient(),conversationId,viewerId,refresh:()=>router.refresh(),state:setStatus,identityLost:clear});
  const visible=()=>{if(document.visibilityState==='visible')watcher.resume();};
  const resume=()=>watcher.resume(),offline=()=>watcher.offline(),leave=()=>{void watcher.close();};
  window.addEventListener('online',resume);window.addEventListener('focus',resume);window.addEventListener('offline',offline);window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',visible);
  return()=>{window.removeEventListener('online',resume);window.removeEventListener('focus',resume);window.removeEventListener('offline',offline);window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',visible);void watcher.close();};
 },[conversationId,viewerId,router,clear]);
 const text={connecting:'Connecting live updates…',live:'Live updates connected.',reconnecting:'Live updates interrupted. Reconnecting… You can still refresh this conversation.',unavailable:'Live updates are temporarily unavailable. Refresh the conversation to check for messages.'}[status];
 return <p role="status" aria-live="polite" className="text-sm text-zinc-600 dark:text-zinc-400">{text}</p>;
}
