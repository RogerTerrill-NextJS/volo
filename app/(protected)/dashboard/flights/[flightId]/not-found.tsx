import Link from '../../../../_components/progress-link';

/** Absent flights and inaccessible PRIVATE flights share this response. */
export default function FlightNotFound(){
 return <main className="space-y-6">
  <h1 className="text-3xl font-semibold tracking-tight">Flight not found</h1>
  <p className="text-zinc-600">This flight is not available.</p>
  <Link href="/dashboard/flights" prefetch={false} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">Back to upcoming flights</Link>
 </main>;
}
