import type { Metadata } from "next";
import { getPageAccess } from "../../../lib/auth/page-access";
import AppShell from "../_components/app-shell";
import AccessState from "../_components/access-state";
import Link from 'next/link';
import {getOwnProfileStatus} from '../../../lib/profiles/query';

export const metadata: Metadata = {
  title: "Volo dashboard",
  description: "Your Volo workspace overview.",
};

export default async function DashboardPage() {
  const access = await getPageAccess();
  if (access.status !== "authorized") return <AccessState status={access.status} />;
  const profile=await getOwnProfileStatus(access.member);

  return (
    <AppShell isAdmin={access.member.role==='admin'}>
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Volo dashboard
        </h1>
        <p className="max-w-xl text-zinc-600 dark:text-zinc-400">
          Welcome to your Volo workspace. Your overview will appear here as
          you get started.
        </p>
      </header>
      {profile==='missing'&&<section aria-labelledby="profile-heading" className="rounded-2xl border border-zinc-200 p-6 dark:border-zinc-800">
        <h2 id="profile-heading" className="text-xl font-semibold">Complete your pilot profile</h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-400">Introduce yourself to other pilots. You can keep browsing and complete your profile later.</p>
        <Link href="/onboarding" prefetch={false} className="mt-4 inline-block rounded-lg bg-zinc-900 px-4 py-3 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 dark:bg-zinc-100 dark:text-zinc-900">Complete profile</Link>
      </section>}
      {profile==='unavailable'&&<p role="status">Your profile could not be checked. You can keep browsing. <a href="/dashboard" className="underline underline-offset-4">Try again</a></p>}
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
    </AppShell>
  );
}
