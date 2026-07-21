"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = createClient();
    client.auth.getUser().then(({ data, error }) => {
      if (!error && data.user) router.replace("/");
    });
  }, [router]);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const client = createClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });

    if (error || !data.session || !data.user) {
      setLoading(false);
      setError(error?.message ?? "Sign-in did not return an authenticated session.");
      return;
    }

    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    setLoading(false);

    if (sessionError || !sessionData.session || !sessionData.session.access_token) {
      setError(sessionError?.message ?? "The session could not be verified after sign-in.");
      return;
    }

    router.replace("/");
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#fcfaef] text-[#171717]">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-[24px] border border-[#e7e0d0] bg-white p-8 shadow-sm">
          <p className="text-xs uppercase tracking-[0.3em] text-[#b08c2c]">Live Better SG</p>
          <h1 className="mt-3 text-2xl font-semibold">Private CRM access</h1>
          <p className="mt-2 text-sm text-[#5f5a52]">Sign in to access the Prospecting OS.</p>
          <form onSubmit={signIn} className="mt-6 space-y-4">
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required placeholder="Email" className="w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-3" />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required placeholder="Password" className="w-full rounded-2xl border border-[#e7e0d0] bg-[#fcfaef] px-3 py-3" />
            {error ? <p className="text-sm text-[#b08c2c]">{error}</p> : null}
            <button disabled={loading} className="w-full rounded-2xl bg-[#171717] px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
