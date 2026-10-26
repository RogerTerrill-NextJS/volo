'use client';
import {useActionState} from 'react';
import {markNotificationRead} from './actions';
export default function MarkRead({id,permalink}:{id:string;permalink:string}){
 const [state,submit,pending]=useActionState<{code:string},FormData>(markNotificationRead,{code:'ready'},permalink);
 const failed=!['ready','read'].includes(state.code);
 return <div className="space-y-2">
  {state.code==='read'?<p role="status">Read</p>:failed?<><p role="alert">We could not confirm this notification’s read status. Reload to check.</p><form action="/notifications" method="get"><button className="min-h-11 underline underline-offset-4">Reload notifications</button></form></>:<form action={submit} aria-busy={pending}><input type="hidden" name="notification_id" value={id}/><button disabled={pending} className="min-h-11 rounded-lg border border-zinc-300 px-4 py-2 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60">{pending?'Marking as read…':'Mark as read'}</button></form>}
  {pending&&<p role="status">Saving read status…</p>}
 </div>;
}
