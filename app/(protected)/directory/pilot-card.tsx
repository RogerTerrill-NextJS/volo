import type {DirectoryProfile} from '../../../lib/profiles/directory-query';
import Link from 'next/link';
import ProfilePhoto from '../_components/profile-photo';
import PilotDetails from '../_components/pilot-details';

export default function PilotCard({pilot}:{pilot:DirectoryProfile}){
 return <li className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-6">
  <article aria-labelledby={`pilot-${pilot.user_id}`} className="space-y-5 [overflow-wrap:anywhere]">
   <header className="flex items-center gap-4">
    <ProfilePhoto userId={pilot.user_id} displayName={pilot.display_name} available={pilot.photoAvailable}/>
    <div className="min-w-0 space-y-1">
     <h2 id={`pilot-${pilot.user_id}`} className="text-xl font-semibold tracking-tight"><Link href={`/directory/${pilot.user_id}`} prefetch={false} className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">{pilot.display_name}</Link></h2>
     <p className="text-sm text-zinc-600">Licensed pilot</p>
    </div>
   </header>
   <PilotDetails pilot={pilot} showMissing/>
  </article>
 </li>;
}
