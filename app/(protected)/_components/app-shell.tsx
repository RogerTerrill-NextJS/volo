import Link from "next/link";

export default function AppShell({ children,isAdmin=false }: { children: React.ReactNode;isAdmin?:boolean }) {
  return (
    <>
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800">
        <span className="text-xl font-semibold tracking-tight">Volo</span>
        <nav aria-label="App navigation" className="flex gap-6 text-sm font-medium">
          <Link href="/dashboard" prefetch={false} className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
            Dashboard
          </Link>
          {isAdmin && <Link href="/admin/invitations" prefetch={false} className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
            Invitations
          </Link>}
          <Link href="/" className="underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4">
            Back to home
          </Link>
        </nav>
      </header>
      <main className="flex flex-col gap-10">{children}</main>
    </>
  );
}
