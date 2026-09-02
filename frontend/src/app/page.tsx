'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { apiRequest } from '@/lib/api';

type AuthResponse = {
  sponsor: {
    id: string;
    name: string;
  };
};

export default function HomePage() {
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData.entries());
    setLoading(true);
    setMessage(null);

    try {
      await apiRequest<AuthResponse>('/sponsors/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      window.location.href = '/dashboard';
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to complete request.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-7xl flex-col justify-center gap-16 px-6 py-12 lg:flex-row lg:items-center">
      <section className="max-w-2xl">
        <span className="rounded-full border border-brand-400/30 bg-brand-400/10 px-4 py-1 text-sm uppercase tracking-[0.3em] text-brand-200">
          Private sponsor operations
        </span>
        <h1 className="mt-6 text-5xl font-semibold text-white sm:text-6xl">
          Whole Donuts sponsor portal
        </h1>
        <p className="mt-6 max-w-xl text-lg text-slate-300">
          Access is issued by program operators. This portal is not a public storefront and does not offer customer checkout.
        </p>
        <div className="mt-10 flex gap-4">
          <Link href="#sign-in" className="rounded-full bg-brand-500 px-6 py-3 font-semibold text-slate-950 transition hover:bg-brand-400">
            Sponsor sign-in
          </Link>
        </div>
      </section>

      <section id="sign-in" className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900/85 p-8 shadow-card">
        <h2 className="text-2xl font-semibold text-white">Sponsor sign-in</h2>
        <p className="mt-2 text-sm text-slate-300">Contact a program operator if you need access.</p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm text-slate-300">Email</label>
            <input name="email" type="email" required className="w-full rounded-2xl border border-slate-700 bg-slate-100 px-4 py-3" />
          </div>
          <div>
            <label className="mb-2 block text-sm text-slate-300">Password</label>
            <input name="password" type="password" required minLength={8} className="w-full rounded-2xl border border-slate-700 bg-slate-100 px-4 py-3" />
          </div>
          <button type="submit" disabled={loading} className="w-full rounded-2xl bg-brand-500 px-4 py-3 font-semibold text-slate-950 transition hover:bg-brand-400 disabled:opacity-70">
            {loading ? 'Working...' : 'Sign in'}
          </button>
        </form>

        {message && <p className="mt-4 text-sm text-brand-200">{message}</p>}
      </section>
    </main>
  );
}
