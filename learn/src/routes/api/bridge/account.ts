/**
 * POST /api/bridge/account — mirror a new learner into the ozituma.com dictionary.
 *
 * WHY THIS ROUTE EXISTS
 *
 * The browser used to call ozituma.com directly and authenticate with
 * `import.meta.env.VITE_LEARN_BRIDGE_SECRET`. A `VITE_` variable is INLINED INTO THE CLIENT BUNDLE
 * by Vite, so the shared secret that gates account creation on ozituma.com was served to every
 * visitor — verified present in two build artifacts:
 *
 *     auth-B27GbBHY.js        EXPOSED
 *     client-_9ffGoBN.js      EXPOSED
 *
 * Anyone opening devtools could read it and POST to the bridge to mint accounts on ozituma.com. The
 * secret is not a token that identifies a learner; it is the only thing standing between the public
 * internet and account creation on the dictionary.
 *
 * The call now happens HERE, on the server, reading a non-`VITE_` variable that is never bundled for
 * the browser. The client asks this route; this route holds the secret.
 *
 * STILL FIRE-AND-FORGET
 *
 * The learner is registered and signed in on learn.ozituma.com before this is called, and a failure
 * here does not undo that. It returns 200 with `bridged: false` rather than an error, because a
 * failed mirror is an operational matter for the next sync — not something to put in front of
 * someone who has just created an account.
 */
import { createFileRoute } from "@tanstack/react-router";

/**
 * Read from the Worker bindings first.
 *
 * On Cloudflare a secret is a BINDING, not a `process.env` entry, so `process.env` alone would find
 * nothing in production. `globalThis.__env__` is populated by the post-build patch to
 * `index.mjs` -- see `scripts/patch-worker-env.mjs` -- and `process.env` remains as the fallback for
 * a local `vite dev` run.
 *
 * Non-`VITE_` on purpose: a `VITE_` prefix is exactly what caused the leak.
 */
function readEnv(key: string): string {
  const bindings = (globalThis as { __env__?: Record<string, unknown> }).__env__;
  const fromBinding = bindings?.[key];
  if (typeof fromBinding === "string" && fromBinding) return fromBinding;
  return process.env[key] ?? "";
}

const bridgeUrl = () => readEnv("LEARN_BRIDGE_URL") || "https://ozituma.com";
const bridgeSecret = () => readEnv("LEARN_BRIDGE_SECRET");

export const Route = createFileRoute("/api/bridge/account")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => handle(request),
    },
  },
});

async function handle(request: Request): Promise<Response> {
  const secret = bridgeSecret();
  if (!secret) {
    // Says nothing useful to a caller and never pretends to have succeeded.
    console.error("[bridge] LEARN_BRIDGE_SECRET is not set; accounts will not reach ozituma.com");
    return Response.json({ ok: true, bridged: false, reason: "not_configured" });
  }

  let body: { email?: unknown; password?: unknown; displayName?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().slice(0, 320) : "";
  const password = typeof body.password === "string" ? body.password : "";
  const displayName = typeof body.displayName === "string" ? body.displayName.slice(0, 120) : "";
  if (!email || !password) return Response.json({ ok: false, error: "missing_fields" }, { status: 400 });

  try {
    const response = await fetch(`${bridgeUrl()}/api/learn-bridge/account`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-learn-bridge": secret },
      body: JSON.stringify({ email, password, displayName }),
    });

    /*
     * The dictionary already having the account is SUCCESS, not a conflict. Both systems are meant to
     * hold the same person, and the bridge is idempotent by design.
     */
    const bridged = response.ok || response.status === 409;
    if (!response.ok && !bridged) {
      console.error("[bridge] mirror failed", response.status);
    }
    return Response.json({ ok: true, bridged });
  } catch (error) {
    console.error("[bridge]", error);
    return Response.json({ ok: true, bridged: false, reason: "unreachable" });
  }
}
