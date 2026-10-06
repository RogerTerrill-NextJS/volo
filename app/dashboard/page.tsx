import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Volo dashboard",
  description: "Your Volo workspace overview.",
};

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12 sm:px-10 sm:py-16">
      <nav aria-label="Dashboard navigation">
        <Link
          href="/"
          className="text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4"
        >
          Back to home
        </Link>
      </nav>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Volo dashboard
        </h1>
        <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
          Welcome to your Volo workspace. Your overview will appear here as
          you get started.
        </p>
      </header>
      <section
        aria-labelledby="overview-heading"
        className="rounded-2xl border border-zinc-200 bg-white p-6 sm:p-8 dark:border-zinc-800 dark:bg-zinc-950"
      >
        <h2 id="overview-heading" className="text-xl font-semibold">
          Workspace overview
        </h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          There is no activity to display yet. This space is ready for your
          upcoming work.
        </p>
      </section>
    </main>
  );
}
