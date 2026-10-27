import type { ReactNode } from 'react';

export function PublicPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-start justify-center bg-night p-4">
      <main className="w-full max-w-2xl space-y-6 rounded-2xl bg-state-gray p-8 shadow-2xl border border-white/5">
        <div className="text-center">
          <p className="text-3xl tracking-tight text-lion">SELENE</p>
          <h1 className="mt-2 text-xl font-semibold text-platinum">{title}</h1>
        </div>
        {children}
      </main>
    </div>
  );
}

export function PublicSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-lion">{title}</h2>
      <div className="space-y-2 text-sm text-platinum">{children}</div>
    </section>
  );
}
