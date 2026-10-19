import type {DirectoryProfile} from '../../../lib/profiles/directory-query';
import ProfilePhoto from '../_components/profile-photo';

export default function PilotCard({pilot}:{pilot:DirectoryProfile}){
 return <li className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
  <article aria-labelledby={`pilot-${pilot.user_id}`} className="space-y-5 [overflow-wrap:anywhere]">
   <header className="flex items-center gap-4">
    <ProfilePhoto userId={pilot.user_id} displayName={pilot.display_name} available={pilot.photoAvailable}/>
    <div className="min-w-0 space-y-1">
     <h2 id={`pilot-${pilot.user_id}`} className="text-xl font-semibold tracking-tight">{pilot.display_name}</h2>
     <p className="text-sm text-zinc-600 dark:text-zinc-400">Licensed pilot</p>
    </div>
   </header>
   <dl className="space-y-4 text-sm">
    <div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Home airport</dt><dd className="mt-1 font-semibold">{pilot.home_airport}</dd></div>
    {pilot.certificates.length>0&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Certificates</dt><dd className="mt-1">{pilot.certificates.join(' · ')}</dd></div>}
    {pilot.ratings.length>0&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Ratings</dt><dd className="mt-1">{pilot.ratings.join(' · ')}</dd></div>}
    {pilot.aircraft_access&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Aircraft access</dt><dd className="mt-1 whitespace-pre-line">{pilot.aircraft_access}</dd></div>}
    {pilot.flying_interests&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Flying interests</dt><dd className="mt-1 whitespace-pre-line">{pilot.flying_interests}</dd></div>}
    {pilot.bio&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">About</dt><dd className="mt-1 whitespace-pre-line">{pilot.bio}</dd></div>}
   </dl>
  </article>
 </li>;
}
