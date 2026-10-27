import type {Metadata} from 'next';
import {randomUUID} from 'node:crypto';
import Link from 'next/link';
import {reportHref} from '../../../../lib/reports/links';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getConversationHistory} from '../../../../lib/messages/history-query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import Composer from './composer';
import RefreshMessages from './refresh-messages';
import LiveMessages from './live-messages';
import {ClearConversationDraft} from './draft';
export const metadata:Metadata={title:'Flight conversation | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const timestamp=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'});
export default async function ConversationPage({params,searchParams}:{params:Promise<{conversationId:string}>;searchParams:Promise<{before?:string|string[]}>}){
 const {conversationId}=await params,href=`/messages/${encodeURIComponent(conversationId)}`;
 const access=await getPageAccess();
 if(access.status!=='authorized'){
 if(access.status==='forbidden')return <><ClearConversationDraft/><AccessState status="forbidden"/></>;
 return <section role="alert" className="space-y-4"><h1 className="text-3xl font-semibold">Unable to verify access</h1><p>We cannot verify your access right now. Please try again.</p><RefreshMessages href={href} label="Try again"/><Link href="/messages" prefetch={false} className={linkClass}>Back to conversations</Link></section>;
 }
 const {before}=await searchParams,result=await getConversationHistory(conversationId,before);
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <><ClearConversationDraft/><AccessState status="forbidden"/></>;
 if(result.status!=='authorized')return <AppShell isAdmin={access.member.role==='admin'}>{result.status==='missing'&&<ClearConversationDraft/>}<section role={result.status==='unavailable'?'alert':undefined} className="space-y-4">
  <h1 className="text-3xl font-semibold tracking-tight">{result.status==='unavailable'?'Conversation temporarily unavailable':result.status==='invalid'?'This message page is unavailable':'Conversation unavailable'}</h1>
  <p>{result.status==='unavailable'?'We could not load this conversation. Please try again.':result.status==='invalid'?'Open the latest messages to continue.':'This conversation could not be found or is no longer available to this account.'}</p>
  {result.status==='unavailable'?<RefreshMessages href={href} label="Try again"/>:result.status==='invalid'&&<Link href={href} prefetch={false} className={linkClass}>Latest messages</Link>}
  <Link href="/messages" prefetch={false} className={linkClass}>Back to conversations</Link>
 </section></AppShell>;
 const {conversation,messages,olderCursor,sendStatus}=result;
 const otherPilotLabel=result.deletedPilot?'Deleted pilot':'Other pilot';
 return <AppShell isAdmin={access.member.role==='admin'}>
  {sendStatus==='closed'&&<ClearConversationDraft/>}
  <Link href="/messages" prefetch={false} className={linkClass}>Back to conversations</Link>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Flight conversation</h1><p>A private conversation between you and the other pilot in this flight connection.</p>
   <Link href={`/dashboard/connections/${conversation.requestId}`} prefetch={false} className={linkClass}>View flight connection</Link>
  </header>
  {sendStatus==='closed'?<section aria-labelledby="closed-conversation" className="space-y-2 rounded-lg border border-zinc-300 p-4"><h2 id="closed-conversation" className="text-xl font-semibold">Conversation closed</h2><p>Sending is no longer available. Your permitted message history remains readable.</p></section>:sendStatus==='unavailable'&&<p role="alert">Sending is temporarily unavailable. Your message history is still readable. Refresh the conversation to check again.</p>}
  <section aria-labelledby="history-heading" className="min-w-0 space-y-5"><h2 id="history-heading" className="text-xl font-semibold">{before?'Older messages':'Messages'}</h2>
   {messages.length?<ol aria-label="Messages, oldest first" className="space-y-4">{messages.map(message=><li key={message.id} id={`message-${message.id}`} className={`min-w-0 space-y-2 rounded-2xl border border-zinc-200 p-4 [overflow-wrap:anywhere] ${message.senderId===access.member.userId?'sm:ml-12':'sm:mr-12'}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold">{message.senderId===access.member.userId?'You':otherPilotLabel}</span><time dateTime={message.createdAt} className="text-sm text-zinc-600">{timestamp.format(new Date(message.createdAt))}</time></div>
    <p className="whitespace-pre-wrap">{message.body}</p>{!message.body.trim()&&<p className="text-sm text-zinc-600">Message contains no visible text.</p>}
    <Link href={reportHref('message',message.id)??'/reports'} prefetch={false} className={linkClass}>Report this message<span className="sr-only"> from {message.senderId===access.member.userId?'you':'the other pilot'} at {timestamp.format(new Date(message.createdAt))}</span></Link>
   </li>)}</ol>:<p>{before?'No older messages.':sendStatus==='available'?'No messages yet. You can start the conversation below.':'No messages were exchanged in this conversation.'}</p>}
   <nav aria-label="Message pages" className="flex flex-wrap gap-6">{olderCursor&&<Link href={`${href}?before=${encodeURIComponent(olderCursor)}`} prefetch={false} className={linkClass}>Older messages</Link>}{before&&<Link href={href} prefetch={false} className={linkClass}>Latest messages</Link>}</nav>
  </section>
  {!before&&sendStatus==='available'&&<Composer key={conversation.id} conversationId={conversation.id} initialMessageId={randomUUID()} viewerId={access.member.userId}/>}
  {before&&sendStatus==='available'&&<p><Link href={href} prefetch={false} className={linkClass}>Go to latest messages to reply</Link></p>}
  {!before&&sendStatus==='available'&&<LiveMessages conversationId={conversation.id} viewerId={access.member.userId}/>}
  <RefreshMessages href={href}/>
 </AppShell>;
}
