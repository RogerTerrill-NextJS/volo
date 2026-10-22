import Link from "next/link";

const linkClass="inline-flex min-h-11 items-center rounded-lg px-2 py-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4";

export default function AccessState({ status,retryHref='/dashboard' }: { status: "forbidden" | "unavailable";retryHref?:string }) {
  const unavailable = status === "unavailable";
  return (
    <main className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">
        {unavailable ? "Unable to verify access" : "Access denied"}
      </h1>
      <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
        {unavailable
          ? "We cannot verify your access right now. Please try again."
          : "Your account does not currently have access to this workspace."}
      </p>
      <nav aria-label="Access options" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium">
        {unavailable && (
          <a href={retryHref} className={linkClass}>
            Try again
          </a>
        )}
        <Link href="/" className={linkClass}>
          Back to home
        </Link>
      </nav>
    </main>
  );
}
