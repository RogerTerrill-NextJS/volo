import type {DirectoryProfile} from '../../../lib/profiles/directory-query';

/** Shared display of approved network fields; no authority or edit controls. */
export default function PilotDetails({pilot,className='space-y-4 text-sm'}:{pilot:DirectoryProfile;className?:string}){
 return <dl className={className}>
  <div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Home airport</dt><dd className="mt-1 font-semibold">{pilot.home_airport}</dd></div>
  {pilot.certificates.length>0&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Certificates</dt><dd className="mt-1">{pilot.certificates.join(' · ')}</dd></div>}
  {pilot.ratings.length>0&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Ratings</dt><dd className="mt-1">{pilot.ratings.join(' · ')}</dd></div>}
  {pilot.aircraft_access&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Aircraft access</dt><dd className="mt-1 whitespace-pre-line">{pilot.aircraft_access}</dd></div>}
  {pilot.flying_interests&&<div><dt className="font-medium text-zinc-600 dark:text-zinc-400">Flying interests</dt><dd className="mt-1 whitespace-pre-line">{pilot.flying_interests}</dd></div>}
  {pilot.bio&&<div className="sm:col-span-2"><dt className="font-medium text-zinc-600 dark:text-zinc-400">About</dt><dd className="mt-1 whitespace-pre-line">{pilot.bio}</dd></div>}
 </dl>;
}
