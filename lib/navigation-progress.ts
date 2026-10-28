export const CLIENT_NAVIGATION_STARTED='volo:client-navigation-started';

type NavigationClick={button:number;defaultPrevented:boolean;metaKey:boolean;ctrlKey:boolean;altKey:boolean;shiftKey:boolean};
type NavigationAnchor={href:string;target:string;download:boolean};

/** Only ordinary, same-origin document navigations need the native observer. */
export function shouldShowDocumentProgress(event:NavigationClick,anchor:NavigationAnchor,currentUrl:string):boolean{
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey)return false;
 if(anchor.download||(anchor.target&&anchor.target.toLowerCase()!=='_self')||!anchor.href||anchor.href.startsWith('#'))return false;
 try{
  const current=new URL(currentUrl),next=new URL(anchor.href,current);
  if(!['http:','https:'].includes(next.protocol)||next.origin!==current.origin)return false;
  return !(anchor.href.includes('#')&&next.pathname===current.pathname&&next.search===current.search);
 }catch{return false;}
}
