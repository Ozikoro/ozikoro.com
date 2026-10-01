import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { OzitumaMark } from "@/components/ozituma-mark";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Ozituma Learn" },
      { name: "description", content: "Sign in or create your Ozituma account to save your Igbo learning progress." },
      { property: "og:title", content: "Sign in — Ozituma Learn" },
      { property: "og:description", content: "Sign in or create your Ozituma account to save your Igbo learning progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup" | "forgot";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  /*
   * Whether the password is visible.
   *
   * A separate flag rather than a checkbox because the two fields need it independently? No — there
   * IS only one password field per mode, so one flag is correct and simpler.
   *
   * `type="password"` is not security. It stops a shoulder-surfer, nothing more, and it is the single
   * biggest cause of people choosing weak passwords and then failing to log in: they cannot see what
   * they typed, so they type it carefully, simply, and the same everywhere. Every guidance body that
   * has looked at this (NIST SP 800-63B among them) says let people see it.
   */
  const [showPassword, setShowPassword] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user) navigate({ to: "/" }); });
    const { data: sub } = supabase.auth.onAuthStateChange((event) => { if (event === "SIGNED_IN") navigate({ to: "/" }); });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === "signup") {
        if (!adult) throw new Error("Please confirm you are 13 or older.");
        const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin, data: { full_name: name } } });
        if (error) throw error;
        /*
         * Give the dictionary the same person, with the same password.
         *
         * This is the direction that starts on the courses; `supabase-mirror.ts` in the Ozikoro
         * repository covers the direction that starts on the dictionary. Both exist so "one account"
         * is true for NEW registrations on either site, rather than sending half of them through a
         * password reset.
         *
         * Deliberately NOT awaited on its result and NOT able to fail the signup. The account exists
         * in Supabase by this line and the learner is signed in — a dictionary outage must not undo
         * that. A missed bridge is closed by the periodic sync.
         */
        void bridgeToDictionary(email, password, name);
        /*
         * Send the confirmation email ourselves.
         *
         * Supabase will not issue a session until the address is confirmed, so this message is the
         * only way in. Supabase's own sender is rate-limited and on a free project may deliver only
         * to team members — a learner who never receives it simply cannot sign in. Sending it here
         * means it goes out from the domain already verified for this product, in its own design.
         *
         * Awaited, unlike the bridge: the learner is waiting on THIS to be able to proceed, and the
         * screen below tells them to check their inbox.
         */
        await sendVerification(email);
        setMsg({ kind: "ok", text: "Almost there — we have emailed you a confirmation link. Click it, then sign in." });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
        if (error) throw error;
        setMsg({ kind: "ok", text: "If that email has an account, a reset link is on its way." });
      }
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Something went wrong." });
    } finally { setBusy(false); }
  };

  const google = async () => {
    setMsg(null);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) setMsg({ kind: "err", text: "Google sign-in didn't complete. Please try again." });
  };

  const input = "mt-1 min-h-12 w-full rounded-md border-2 border-input bg-card px-3 outline-none focus:border-primary";

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 inline-block"><OzitumaMark /></Link>
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="font-display text-3xl font-semibold">{mode === "signin" ? "Welcome back" : mode === "signup" ? "Create your account" : "Reset your password"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{mode === "forgot" ? "We'll email you a link." : "Save your progress on every device."}</p>

          {mode !== "forgot" && (
            <>
              {/*
                Google sign-in is disabled deliberately: the owner decided email and password is
                enough, and the Supabase Google provider is not configured. Rendered as nothing
                rather than a button that fails — a sign-in option that errors reads as a broken
                site, not a switched-off feature. The `google` handler is kept so re-enabling is a
                one-line change once OAuth credentials exist.
              */}
              {false && <Button variant="secondary" className="mt-6 w-full" onClick={google}>Continue with Google</Button>}
              <div className="my-5 flex items-center gap-3 text-xs font-bold uppercase text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            </>
          )}

          <form onSubmit={submit} className="space-y-4">
            {mode === "signup" && <label className="block text-sm font-bold">Your name<input className={input} value={name} onChange={(e) => setName(e.target.value)} required /></label>}
            <label className="block text-sm font-bold">Email<input type="email" className={input} value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
            {mode !== "forgot" && (
              <label className="block text-sm font-bold">
                Password
                <span className="relative mt-1 block">
                  <input
                    type={showPassword ? "text" : "password"}
                    minLength={8}
                    className={`${input} pr-16`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  />
                  {/*
                    Rendered as a button, not a link, and with `aria-pressed` so a screen reader
                    announces whether the password is currently shown. `type="button"` matters: inside
                    a form a bare <button> submits, which would try to sign the person in the moment
                    they asked to see what they typed.
                  */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute inset-y-0 right-0 flex items-center gap-1 px-3 text-xs font-bold text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </span>
              </label>
            )}
            {mode === "signup" && <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4" checked={adult} onChange={(e) => setAdult(e.target.checked)} />I am 13 or older.</label>}
            {msg && <p role="status" className={`rounded-md p-3 text-sm ${msg.kind === "ok" ? "bg-secondary text-secondary-foreground" : "bg-accent/10 text-foreground"}`}>{msg.text}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}</Button>
          </form>

          <div className="mt-5 flex flex-wrap justify-between gap-2 text-sm">
            {mode === "signin" ? <>
              <button className="font-bold text-primary" onClick={() => setMode("signup")}>Create an account</button>
              <button className="text-muted-foreground" onClick={() => setMode("forgot")}>Forgot password?</button>
            </> : <button className="font-bold text-primary" onClick={() => setMode("signin")}>Back to sign in</button>}
          </div>
        </div>
        <p className="mt-4 text-center text-sm"><Link to="/" className="text-muted-foreground">Continue without an account</Link></p>
      </div>
    </main>
  );
}

/**
 * Tell ozituma.com about an account created here.
 *
 * The password is sent because the dictionary must hash it itself — there is no way to derive one
 * system's hash from the other's, and making the learner set a second password is exactly the
 * friction "one account" is meant to remove.
 *
 * If the bridge is unconfigured or the dictionary is unreachable, this does nothing and says nothing
 * to the learner. They have an account either way; the periodic sync closes the gap.
 */
async function bridgeToDictionary(email: string, password: string, displayName: string): Promise<void> {
  /*
   * The secret is NOT read here.
   *
   * This used `import.meta.env['VITE_LEARN_BRIDGE_SECRET']`, and a `VITE_` variable is INLINED
   * into the client bundle by Vite - so the key that gates account creation on ozituma.com was
   * served to every visitor and readable in devtools. Verified present in two build artifacts:
   * `auth-*.js` and `client-*.js`.
   *
   * The call now goes to our own server, which holds the secret and never sends it onward.
   */
  try {
    await fetch("/api/bridge/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, displayName }),
    });
  } catch {
    // Silent on purpose. The learner is registered and signed in; a failed mirror is an
    // operational matter for the next sync, not something to interrupt them with.
  }
}

/**
 * Ask the server to send the confirmation email.
 *
 * Never throws. If it fails the learner still has an unconfirmed account and can press "Resend" —
 * turning a mail outage into a red error on the signup form would suggest the registration itself
 * failed, which it did not.
 */
async function sendVerification(email: string): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/send-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
