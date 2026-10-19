import Link from 'next/link';

/** Missing and ineligible targets share one response without account-state detail. */
export default function ProfileNotFound(){
 return <main className="space-y-6">
  <h1 className="text-3xl font-semibold tracking-tight">Profile not found</h1>
  <p className="text-zinc-600 dark:text-zinc-400">This pilot profile is not available.</p>
  <Link href="/directory" prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Back to directory</Link>
 </main>;
}
