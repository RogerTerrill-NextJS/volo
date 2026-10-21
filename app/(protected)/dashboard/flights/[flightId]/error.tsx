'use client';
import Link from 'next/link';
export default function FlightDetailError(){
 return <main className="space-y-6"><h1 className="text-3xl font-semibold tracking-tight">Flight temporarily unavailable</h1><p role="alert">We could not load this flight. Please try again.</p><button onClick={()=>window.location.reload()} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Try again</button><Link href="/dashboard/flights" prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4">Back to upcoming flights</Link></main>;
}
