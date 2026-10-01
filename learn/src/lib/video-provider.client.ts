/**
 * The provider SDK boundary.
 *
 * This is the ONLY file that knows which video provider is in use. Everything else goes through
 * `VideoService`. Replacing the provider means rewriting this file and nothing else — which is the
 * whole reason the interface exists.
 *
 * IT IS A STUB, AND SAYS SO
 *
 * No provider SDK is installed and no provider API key exists, so this cannot connect to a real
 * room. What it does instead is refuse honestly: `joinRoom` throws, and the classroom UI shows that
 * the provider is not configured rather than pretending to be live. A stub that silently succeeded
 * would let a teacher believe a lesson was happening.
 *
 * WHAT THE REAL IMPLEMENTATION DOES
 *
 * Whatever SDK is chosen, the four things below are all an adapter needs:
 *
 *   1. load the SDK lazily (it is large; a learner reading a dictionary page must not download it)
 *   2. create/join the room with the server-minted token
 *   3. publish the local stream
 *   4. subscribe to remote participants and hand them to the UI
 *
 * Point 4 is the one with a shape decision attached: the UI needs remote streams pushed to it, so a
 * real implementation exposes a subscriber. That is deliberately NOT part of `VideoService` yet —
 * adding a callback the only implementation cannot honour would be inventing an interface rather
 * than writing one.
 */

interface JoinOptions {
  url: string;
  token: string;
  stream: MediaStream | null;
}

/** The provider's client object, once loaded. Untyped until an SDK is chosen. */
let client: unknown = null;

export function providerConfigured(): boolean {
  // The URL is the signal: it comes from the server only when the server holds a provider key.
  return Boolean(import.meta.env['VITE_CLASSROOM_PROVIDER_URL']);
}

export async function joinRoom({ url, token, stream }: JoinOptions): Promise<void> {
  if (!providerConfigured()) {
    throw new Error(
      'The classroom video provider is not configured on this deployment. A provider key must be set on the server.'
    );
  }

  /*
   * A real adapter goes here. The shape, for whichever provider:
   *
   *   const SDK = await import('@daily-co/daily-js')          // or livekit-client, etc.
   *   const call = SDK.default.createCallObject()
   *   await call.join({ url, token })
   *   if (stream) await call.setLocalVideo(stream)            // or publish each track
   *   client = call
   *
   * `token` is never logged. It is a bearer credential for the room, and a room token in a log is a
   * room anyone can join.
   */
  void url;
  void token;
  void stream;
  client = null;

  throw new Error('No classroom video provider is installed.');
}

export async function leaveRoom(): Promise<void> {
  // A real adapter calls `client.leave()` and then destroys it, so a later join starts clean.
  client = null;
}

/**
 * Whether the local participant is actually connected.
 *
 * Exposed because the classroom must not show a green "connected" state it has not earned. The real
 * adapter returns the provider's own connection state.
 */
export function isConnected(): boolean {
  return client !== null;
}
