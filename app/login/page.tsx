import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Sign in | Volo",
  description: "Sign in to your Volo workspace.",
};

// VOLO-22 replaces this public destination with the login flow.
export default function LoginPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-12 sm:px-10 sm:py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-zinc-600 dark:text-zinc-400">Sign-in is not available yet</p>
      <Link href="/" className="w-fit text-sm font-medium underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
        Back to home
      </Link>
    </main>
  );
}
