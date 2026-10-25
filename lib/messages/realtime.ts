import type {SupabaseClient,RealtimeChannel} from '@supabase/supabase-js';
import type {Database} from '../supabase/database.types.ts';
import {messageUuid} from './validation.ts';
export type LiveClient=Pick<SupabaseClient<Database>,'auth'|'channel'|'removeChannel'>;
export type LiveState='connecting'|'live'|'reconnecting'|'unavailable';
/** Events only invalidate persisted history. Never retain or render socket bodies. */
export function watchConversation({client,conversationId,viewerId,refresh,state,identityLost=()=>{},schedule=run=>setTimeout(run,150),cancel=token=>clearTimeout(token as ReturnType<typeof setTimeout>)}:{client:LiveClient;conversationId:string;viewerId:string;refresh:()=>void;identityLost?:()=>void;state:(value:LiveState)=>void;schedule?:(run:()=>void)=>unknown;cancel?:(token:unknown)=>void}){
 let disposed=false,channel:RealtimeChannel|null=null,timer:unknown=null,lastState:LiveState='connecting',removal:Promise<void>|null=null;
 let unsubscribeAuth=()=>{},starting=false;
 const report=(value:LiveState)=>{if(!disposed&&value!==lastState){lastState=value;state(value);}};
 const queue=()=>{if(!disposed&&timer===null)timer=schedule(()=>{timer=null;if(!disposed)refresh();});};
 const close=()=>{
  if(removal)return removal;
  disposed=true;if(timer!==null){cancel(timer);timer=null;}unsubscribeAuth();
  removal=channel?Promise.resolve(client.removeChannel(channel)).then(()=>{},()=>{}):Promise.resolve();channel=null;return removal;
 };
 const changedIdentity=()=>{if(disposed)return;void close();identityLost();refresh();};
 const subscription=client.auth.onAuthStateChange((event,session)=>{
  if(disposed)return;
  if(!session&&event!=='SIGNED_OUT'){report('unavailable');queue();return;}
  if(session?.user.id!==viewerId){changedIdentity();return;}
  // Supabase's shared client updates Realtime auth itself. Catch up after rotation.
  if(event==='TOKEN_REFRESHED'||event==='SIGNED_IN'){queueMicrotask(connect);queue();}
 });
 unsubscribeAuth=()=>subscription.data.subscription.unsubscribe();
 function connect(){
  if(disposed||channel||starting)return;starting=true;
  void client.auth.getSession().then(({data,error})=>{
  starting=false;
  if(disposed)return;
  if(error){report('unavailable');queue();return;}
  if(data.session?.user.id!==viewerId){changedIdentity();return;}
  if(!messageUuid.test(conversationId)||!messageUuid.test(viewerId)){report('unavailable');queue();return;}
  channel=client.channel(`conversation:${conversationId}`,{config:{postgres_changes_options:{wait:true,timeout:15000}}});
  channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:`conversation_id=eq.${conversationId}`},payload=>{
    if(disposed||!payload||typeof payload!=='object'||payload.eventType!=='INSERT')return;
    const row=payload.new;
    if(row&&typeof row==='object'&&!Array.isArray(row)&&row.conversation_id===conversationId&&typeof row.id==='string'&&messageUuid.test(row.id))queue();
   }).subscribe(status=>{
    if(disposed)return;
    if(status==='SUBSCRIBED'){report('live');queue();}
    else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'||status==='CLOSED'){
     const changed=lastState!=='reconnecting';report('reconnecting');if(changed)queue();
    }
   });
 }).catch(()=>{starting=false;if(!disposed){report('unavailable');queue();}});
 }
 connect();
 return {close,resume:()=>{connect();queue();},offline:()=>report('reconnecting')};
}
