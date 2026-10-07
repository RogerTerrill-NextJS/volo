// The group organizes pages; each page independently checks access before output.
export const dynamic = "force-dynamic";

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12 sm:px-10 sm:py-16">
      {children}
    </div>
  );
}
