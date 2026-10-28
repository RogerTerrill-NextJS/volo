'use client';
import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {CLIENT_NAVIGATION_STARTED,shouldShowDocumentProgress} from '../../lib/navigation-progress';

export function NavigationProgressBar(){
 return createPortal(<div className="navigation-progress" role="status" aria-live="polite"><span className="sr-only">Loading page…</span><div className="navigation-progress-track" aria-hidden="true"/></div>,document.body);
}

/** Native anchors retain full-document reloads for explicit access/error rechecks. */
export default function DocumentNavigationProgress(){
 const [pending,setPending]=useState(false);
 useEffect(()=>{
  let expiry:ReturnType<typeof setTimeout>|undefined;
  const clear=()=>{clearTimeout(expiry);setPending(false);};
  const click=(event:MouseEvent)=>{
   const anchor=event.target instanceof Element?event.target.closest('a'):null;
   if(!anchor||!shouldShowDocumentProgress(event,{href:anchor.getAttribute('href')??'',target:anchor.getAttribute('target')??'',download:anchor.hasAttribute('download')},window.location.href))return;
   setPending(true);
   clearTimeout(expiry);
   // A cancelled/blocked document unload has no universal completion event.
   // Bound its cosmetic feedback without retrying or changing navigation.
   expiry=setTimeout(clear,30_000);
  };
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape')clear();};
  document.addEventListener(CLIENT_NAVIGATION_STARTED,clear);
  document.addEventListener('click',click);
  document.addEventListener('keydown',key);
  window.addEventListener('pageshow',clear);
  window.addEventListener('popstate',clear);
  return()=>{clearTimeout(expiry);document.removeEventListener(CLIENT_NAVIGATION_STARTED,clear);document.removeEventListener('click',click);document.removeEventListener('keydown',key);window.removeEventListener('pageshow',clear);window.removeEventListener('popstate',clear);};
 },[]);
 return pending?<NavigationProgressBar/>:null;
}
