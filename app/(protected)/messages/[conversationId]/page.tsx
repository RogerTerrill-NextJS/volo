import type {Metadata} from 'next';
import {randomUUID} from 'node:crypto';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getPageAccess} from '../../../../lib/auth/page-access';
import {getConversationHistory} from '../../../../lib/messages/history-query';
import AppShell from '../../_components/app-shell';
import AccessState from '../../_components/access-state';
import Composer from './composer';
import RefreshMessages from './refresh-messages';
export const metadata:Metadata={title:'Flight conversation | Volo',robots:{index:false,follow:false}};
const linkClass='inline-flex min-h-11 w-fit items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4';
const timestamp=new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'long',timeZone:'UTC'});
export default async function ConversationPage({params,searchParams}:{params:Promise<{conversationId:string}>;searchParams:Promise<{before?:string|string[]}>}){
 const access=await getPageAccess();if(access.status!=='authorized')return <AccessState status={access.status} retryHref="/messages"/>;
 const {conversationId}=await params,{before}=await searchParams,result=await getConversationHistory(conversationId,before),href=`/messages/${encodeURIComponent(conversationId)}`;
 if(result.status==='unauthenticated')redirect('/login?reason=authentication-required');
 if(result.status==='forbidden')return <AccessState status="forbidden"/>;
 if(result.status!=='authorized')return <AppShell isAdmin={access.member.role==='admin'}><section role={result.status==='unavailable'?'alert':undefined} className="space-y-4">
  <h1 className="text-3xl font-semibold tracking-tight">{result.status==='unavailable'?'Conversation temporarily unavailable':result.status==='invalid'?'This message page is unavailable':'Conversation unavailable'}</h1>
  <p>{result.status==='unavailable'?'We could not load this conversation. Please try again.':result.status==='invalid'?'Open the latest messages to continue.':'This conversation could not be found or is no longer available to this account.'}</p>
  {result.status==='unavailable'?<form action={href} method="get"><button className={linkClass}>Try again</button></form>:result.status==='invalid'&&<Link href={href} prefetch={false} className={linkClass}>Latest messages</Link>}
  <Link href="/messages" prefetch={false} className={linkClass}>Back to conversations</Link>
 </section></AppShell>;
 const {conversation,messages,olderCursor,sendStatus}=result;
 return <AppShell isAdmin={access.member.role==='admin'}>
  <Link href="/messages" prefetch={false} className={linkClass}>Back to conversations</Link>
  <header className="space-y-3"><h1 className="text-3xl font-semibold tracking-tight">Flight conversation</h1><p>A private conversation between you and the other pilot in this flight connection.</p>
   <Link href={`/dashboard/connections/${conversation.requestId}`} prefetch={false} className={linkClass}>View flight connection</Link>
  </header>
  {sendStatus==='closed'?<section aria-labelledby="closed-conversation" className="space-y-2 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700"><h2 id="closed-conversation" className="text-xl font-semibold">Conversation closed</h2><p>Sending is no longer available. Your permitted message history remains readable.</p></section>:sendStatus==='unavailable'&&<p role="alert">Sending is temporarily unavailable. Your message history is still readable. Refresh the conversation to check again.</p>}
  <section aria-labelledby="history-heading" className="min-w-0 space-y-5"><h2 id="history-heading" className="text-xl font-semibold">{before?'Older messages':'Messages'}</h2>
   {messages.length?<ol aria-label="Messages, oldest first" className="space-y-4">{messages.map(message=><li key={message.id} id={`message-${message.id}`} className={`min-w-0 space-y-2 rounded-2xl border border-zinc-200 p-4 [overflow-wrap:anywhere] dark:border-zinc-800 ${message.senderId===access.member.userId?'sm:ml-12':'sm:mr-12'}`}>
    <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="font-semibold">{message.senderId===access.member.userId?'You':'Other pilot'}</span><time dateTime={message.createdAt} className="text-sm text-zinc-600 dark:text-zinc-400">{timestamp.format(new Date(message.createdAt))}</time></div>
    <p className="whitespace-pre-wrap">{message.body}</p>{!message.body.trim()&&<p className="text-sm text-zinc-600 dark:text-zinc-400">Message contains no visible text.</p>}
   </li>)}</ol>:<p>{before?'No older messages.':sendStatus==='available'?'No messages yet. You can start the conversation below.':'No messages were exchanged in this conversation.'}</p>}
   <nav aria-label="Message pages" className="flex flex-wrap gap-6">{olderCursor&&<Link href={`${href}?before=${encodeURIComponent(olderCursor)}`} prefetch={false} className={linkClass}>Older messages</Link>}{before&&<Link href={href} prefetch={false} className={linkClass}>Latest messages</Link>}</nav>
  </section>
  {!before&&sendStatus==='available'&&<Composer key={conversation.id} conversationId={conversation.id} initialMessageId={randomUUID()}/>}
  {before&&sendStatus==='available'&&<p><Link href={href} prefetch={false} className={linkClass}>Go to latest messages to reply</Link></p>}
  <RefreshMessages href={href}/>
 </AppShell>;
}
