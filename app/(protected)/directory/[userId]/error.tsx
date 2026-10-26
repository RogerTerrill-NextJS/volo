'use client';
import Link from 'next/link';

export default function ProfileError(){
 return <main className="space-y-6">
  <h1 className="text-3xl font-semibold tracking-tight">Profile temporarily unavailable</h1>
  <p role="alert" className="text-zinc-600">We could not load this pilot profile. Please try again.</p>
  <button onClick={()=>window.location.reload()} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Try again</button>
  <Link href="/directory" prefetch={false} className="ml-6 inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Back to directory</Link>
 </main>;
}
