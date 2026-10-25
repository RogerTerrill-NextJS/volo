'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useState} from 'react';
import type {ComposerState} from '../../../../lib/messages/composer-state';
type Draft={viewerId:string;state:ComposerState};
type DraftContext={draft:Draft|null;save:(viewerId:string,state:ComposerState)=>void;clear:()=>void};
const Context=createContext<DraftContext|null>(null);
/** One in-memory form draft, never messages or browser storage; survives page refresh errors. */
export function ConversationDraft({children}:{children:React.ReactNode}){
 const [draft,setDraft]=useState<Draft|null>(null);
 const save=useCallback((viewerId:string,state:ComposerState)=>setDraft({viewerId,state}),[]),clear=useCallback(()=>setDraft(null),[]);
 const value=useMemo(()=>({draft,save,clear}),[draft,save,clear]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useConversationDraft(){const value=useContext(Context);if(!value)throw Error('Conversation draft unavailable');return value;}
export function ClearConversationDraft(){const {clear}=useConversationDraft();useEffect(()=>clear(),[clear]);return null;}
