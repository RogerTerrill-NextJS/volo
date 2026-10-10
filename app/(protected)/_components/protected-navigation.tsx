'use client';
import {useEffect,useRef} from 'react';

/** A restored document must recheck access with the browser's current cookies. */
export default function ProtectedNavigation({children}:{children:React.ReactNode}){
 const content=useRef<HTMLDivElement>(null);
 useEffect(()=>{
  const hide=()=>{if(content.current)content.current.hidden=true;};
  const restore=(event:PageTransitionEvent)=>{if(event.persisted){hide();window.location.reload();}};
  window.addEventListener('pagehide',hide);window.addEventListener('pageshow',restore);
  return()=>{window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',restore);};
 },[]);
 return <div ref={content}>{children}</div>;
}
