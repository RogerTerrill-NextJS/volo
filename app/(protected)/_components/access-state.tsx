import Link from "next/link";

export default function AccessState({ status }: { status: "forbidden" | "unavailable" }) {
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
      <nav aria-label="Access options" className="flex gap-6 text-sm font-medium">
        {unavailable && (
          <a href="/dashboard" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
            Try again
          </a>
        )}
        <Link href="/" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
          Back to home
        </Link>
      </nav>
    </main>
  );
}
