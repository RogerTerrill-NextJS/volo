'use client';
import Link,{useLinkStatus} from 'next/link';
import type {ComponentProps} from 'react';
import {CLIENT_NAVIGATION_STARTED} from '../../lib/navigation-progress';
import {NavigationProgressBar} from './navigation-progress';

function PendingNavigation(){
 const {pending}=useLinkStatus();
 return pending?<NavigationProgressBar/>:null;
}

/** Preserve Next Link behavior and let its own transition state own feedback. */
export default function ProgressLink({children,onNavigate,...props}:ComponentProps<typeof Link>){
 return <Link {...props} onNavigate={event=>{
  let prevented=false;
  onNavigate?.({...event,preventDefault:()=>{prevented=true;event.preventDefault();}});
  // Cached/prefetched navigations may skip pending state entirely.
  if(!prevented)document.dispatchEvent(new Event(CLIENT_NAVIGATION_STARTED));
 }}>{children}<PendingNavigation/></Link>;
}
