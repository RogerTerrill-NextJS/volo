'use client';
export default function FlightFormError(){
 return <section role="alert" className="space-y-4">
  <h1 className="text-2xl font-semibold">Unable to confirm flight publication</h1>
  <p>If you submitted a flight, it may have been published. Verify your flights before trying again.</p>
  <a href="/dashboard" className="inline-block py-3 underline underline-offset-4">Back to dashboard</a>
 </section>;
}
