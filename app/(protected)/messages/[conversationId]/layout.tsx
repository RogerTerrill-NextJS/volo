import {ConversationDraft} from './draft';
export default async function ConversationLayout({children,params}:{children:React.ReactNode;params:Promise<{conversationId:string}>}){
 const {conversationId}=await params;
 return <ConversationDraft key={conversationId}>{children}</ConversationDraft>;
}
