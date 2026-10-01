import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/button";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password — Ozituma" },
      { name: "description", content: "Choose a new password for your Ozituma account." },
      { property: "og:title", content: "Set a new password — Ozituma" },
      { property: "og:description", content: "Choose a new password for your Ozituma account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setMsg(error.message); else navigate({ to: "/" });
  };
  return (
    <main className="grid min-h-screen place-items-center bg-background px-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <h1 className="font-display text-3xl font-semibold">Set a new password</h1>
        <label className="mt-6 block text-sm font-bold">New password
          <input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 min-h-12 w-full rounded-md border-2 border-input bg-card px-3 outline-none focus:border-primary" />
        </label>
        {msg && <p className="mt-3 text-sm">{msg}</p>}
        <Button type="submit" className="mt-5 w-full">Save password</Button>
      </form>
    </main>
  );
}
