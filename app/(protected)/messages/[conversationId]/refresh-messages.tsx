'use client';
import {useTransition} from 'react';
import {useRouter} from 'next/navigation';
export default function RefreshMessages({href}:{href:string}){
 const router=useRouter(),[pending,start]=useTransition();
 return <form action={href} method="get" onSubmit={event=>{event.preventDefault();start(()=>router.refresh());}}>
  <button disabled={pending} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 disabled:opacity-60">{pending?'Refreshing messages…':'Refresh conversation'}</button>
  {pending&&<span role="status" className="sr-only">Refreshing conversation</span>}
 </form>;
}
