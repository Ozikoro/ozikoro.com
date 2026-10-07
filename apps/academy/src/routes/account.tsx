import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AcademyShell } from "@/components/academy-shell";
import { Button } from "@/components/ui/button";
import { OzikoroMark } from "@/components/ozikoro-mark";
import { changePassword, currentUser, signIn, signOut, signUp } from "@/backend/functions";

export const Route = createFileRoute("/account")({
  head: () => ({
    meta: [
      { title: "Sign in — Ozikoro Academy" },
      { name: "description", content: "Sign in to continue your Ozikoro Academy learning." },
      { property: "og:title", content: "Sign in — Ozikoro Academy" },
      { property: "og:description", content: "Continue your studies and save your progress." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  // THE SIGNED-IN STATE IS RESOLVED ON THE SERVER, BEFORE THE PAGE RENDERS.
  //
  // Doing it here rather than in an effect means somebody who is already signed in never sees the
  // form flash before being redirected, and the page needs no loading state to be correct.
  loader: async () => ({ account: (await currentUser()).account }),
  component: AccountPage,
});

const MIN_PASSWORD_LENGTH = 10;

function AccountPage() {
  const { account } = Route.useLoaderData();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The change-password form. Its own state rather than the sign-in form's, because the two are on
  // different screens of this page and a shared busy flag would disable both at once.
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Already signed in: there is nothing to do on this page, so it sends them to their learning
  // rather than showing a second sign-in form.
  if (account) {
    return (
      <AcademyShell>
        <section className="account-page">
          <div className="account-card">
            <div className="brand-mark mx-auto">
              <OzikoroMark className="ozikoro-mark" />
            </div>
            <p className="eyebrow mt-5 text-center text-primary">Ozikoro Academy</p>
            <h1>You are signed in</h1>
            <p className="intro">
              Signed in as <strong>{account.email}</strong>.
            </p>
            <Button className="w-full" size="lg" onClick={() => navigate({ to: "/my-learning" })}>
              Go to My Learning
            </Button>

            {/*
              CHANGE YOUR OWN PASSWORD.

              THE CURRENT PASSWORD IS REQUIRED, AND THAT IS NOT A CONVENIENCE FIELD. The session proves that
              a browser signed in at some point; the current password is the only thing that proves this
              person is the account holder. A form that swapped the password without asking for the old one
              would turn a borrowed session into a permanent takeover, so the input is `required` here AND
              the server refuses without it — the browser attribute is a courtesy, not the check.
            */}
            <form
              className="mt-6 text-left"
              onSubmit={async (event) => {
                event.preventDefault();
                setPwMessage(null);
                setPwBusy(true);
                try {
                  const result = await changePassword({
                    data: { currentPassword, newPassword, confirmPassword },
                  });
                  if (!result.ok) {
                    setPwMessage({ ok: false, text: result.message });
                    return;
                  }
                  setPwMessage({
                    ok: true,
                    text: "Your password is changed. Every other device that was signed in has been signed out.",
                  });
                  setCurrentPassword("");
                  setNewPassword("");
                  setConfirmPassword("");
                } catch {
                  setPwMessage({ ok: false, text: "Something went wrong. Please try again." });
                } finally {
                  setPwBusy(false);
                }
              }}
            >
              <h2 className="text-lg font-semibold">Change your password</h2>
              <label>
                Current password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                New password again
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </label>
              <p className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters. Changing it signs out every other device.
              </p>

              {/* role="alert" so a screen reader announces the answer rather than leaving the learner on a
                  form that silently did nothing. */}
              {pwMessage && (
                <p
                  role="alert"
                  className={
                    pwMessage.ok
                      ? "text-sm font-semibold text-primary"
                      : "text-sm font-semibold text-destructive"
                  }
                >
                  {pwMessage.text}
                </p>
              )}

              <Button className="w-full" size="lg" type="submit" disabled={pwBusy}>
                {pwBusy ? "Please wait…" : "Change password"}
              </Button>
            </form>

            <Button
              variant="ghost"
              className="mt-4 w-full"
              type="button"
              onClick={async () => {
                await signOut();
                // Full navigation, not a router transition: the cookie has just been cleared on the
                // server and every cached loader still holds the signed-in result.
                window.location.assign("/");
              }}
            >
              Sign out
            </Button>
            <Link className="mt-6 block text-center text-xs" to="/">
              Return to Academy
            </Link>
          </div>
        </section>
      </AcademyShell>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result =
        mode === "in"
          ? await signIn({ data: { email, password } })
          : await signUp({ data: { email, password, displayName } });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      // Full navigation, not a router transition: the session is a new cookie the server has just
      // set, and the loader for every other page has to re-run against it. A client-side transition
      // would keep the loaders' cached signed-out results.
      window.location.assign("/my-learning");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AcademyShell>
      <section className="account-page">
        <div className="account-card">
          <div className="brand-mark mx-auto">
            <OzikoroMark className="ozikoro-mark" />
          </div>
          <p className="eyebrow mt-5 text-center text-primary">Ozikoro Academy</p>
          <h1>{mode === "in" ? "Welcome back" : "Begin your studies"}</h1>
          <p className="intro">
            {mode === "in"
              ? "Sign in to resume learning and see your academic record."
              : "Create an account to enrol, save progress and earn certificates."}
          </p>

          <form onSubmit={submit}>
            {mode === "up" && (
              <label>
                Your name <span className="text-muted-foreground">(optional)</span>
                <input
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                required
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                autoComplete={mode === "in" ? "current-password" : "new-password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {mode === "up" && (
              <p className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.
              </p>
            )}

            {/* role="alert" so a screen reader announces the failure rather than leaving the
                learner on a form that silently did nothing. */}
            {error && (
              <p role="alert" className="text-sm font-semibold text-primary">
                {error}
              </p>
            )}

            <Button className="w-full" size="lg" type="submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <p className="switch">
            {mode === "in" ? "New to the Academy? " : "Already have an account? "}
            <button
              type="button"
              onClick={() => {
                setMode(mode === "in" ? "up" : "in");
                setError(null);
              }}
            >
              {mode === "in" ? "Create an account" : "Sign in"}
            </button>
          </p>
          <Link className="mt-6 block text-center text-xs" to="/">
            Return to Academy
          </Link>
        </div>
      </section>
    </AcademyShell>
  );
}
