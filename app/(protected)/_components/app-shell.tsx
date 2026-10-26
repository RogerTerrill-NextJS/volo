import Link from "next/link";
import ProtectedNavigation from './protected-navigation';

const navigationClass="inline-flex min-h-11 items-center rounded-lg px-2 py-2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4";

export default function AppShell({ children,isAdmin=false }: { children: React.ReactNode;isAdmin?:boolean }) {
  return (
    <ProtectedNavigation>
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-6">
        <span className="text-xl font-semibold tracking-tight">Volo</span>
        <nav aria-label="App navigation" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm font-medium">
          <Link href="/dashboard" prefetch={false} className={navigationClass}>
            Dashboard
          </Link>
          <Link href="/dashboard/flights" prefetch={false} className={navigationClass}>Upcoming flights</Link>
          <Link href="/notifications" prefetch={false} className={navigationClass}>Notifications</Link>
          <Link href="/messages" prefetch={false} className={navigationClass}>Messages</Link>
          <Link href="/directory" prefetch={false} className={navigationClass}>
            Pilot directory
          </Link>
          <Link href="/reports" prefetch={false} className={navigationClass}>Report and support</Link>
          <Link href="/profile/edit" prefetch={false} className={navigationClass}>My profile</Link>
          {isAdmin && <Link href="/admin/invitations" prefetch={false} className={navigationClass}>
            Invitations
          </Link>}
          {isAdmin && <Link href="/admin/members" prefetch={false} className={navigationClass}>Members</Link>}
          {isAdmin && <Link href="/admin/reports" prefetch={false} className={navigationClass}>Reports</Link>}
          {isAdmin && <Link href="/admin/metrics" prefetch={false} className={navigationClass}>MVP metrics</Link>}
          {isAdmin && <Link href="/admin/flights" prefetch={false} className={navigationClass}>Flight moderation</Link>}
          <Link href="/" className={navigationClass}>
            Back to home
          </Link>
          <form action="/auth/logout" method="post">
            <button type="submit" className={navigationClass}>Sign out</button>
          </form>
        </nav>
      </header>
      <main className="flex flex-col gap-10">{children}</main>
    </ProtectedNavigation>
  );
}
