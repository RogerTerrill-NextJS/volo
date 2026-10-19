'use client';

/** Reload through the server access guard; never render unexpected error details. */
export default function DirectoryError(){
 return <main className="space-y-6">
  <h1 className="text-3xl font-semibold tracking-tight">Directory temporarily unavailable</h1>
  <p role="alert" className="text-zinc-600 dark:text-zinc-400">We could not load the directory. Please try again.</p>
  <a href="/directory" className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Try again</a>
 </main>;
}
