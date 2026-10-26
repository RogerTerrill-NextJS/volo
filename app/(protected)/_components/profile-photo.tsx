'use client';
import Image from 'next/image';
import {useState} from 'react';

/** Cookie-authenticated images bypass the public image optimizer and its cache. */
export default function ProfilePhoto({userId,displayName,available=true,revision=0}:{userId:string;displayName:string;available?:boolean;revision?:number}){
 const [failed,setFailed]=useState(false);
 const initials=displayName.trim().split(/\s+/).slice(0,2).map(word=>[...word][0]??'').join('').toUpperCase()||'P';
 return <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-100 text-2xl font-semibold text-zinc-700">
  {available&&!failed?<Image src={`/api/profiles/${userId}/photo?v=${revision}`} alt={`${displayName}'s profile photo`} width={96} height={96} unoptimized onError={()=>setFailed(true)} className="h-full w-full object-cover"/>
   :<span role="img" aria-label={`No profile photo available for ${displayName}`}>{initials}</span>}
 </div>;
}
