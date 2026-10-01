/**
 * The classroom video adapter.
 *
 * WHY AN ADAPTER AND NOT A PROVIDER SDK
 *
 * `AGENTS.md`: "Frontend owns presentation and interaction only; consume DSH-owned … video …
 * state without recreating business logic." The classroom UI at `/platform` calls `VideoService`
 * and nothing else, so the provider is a deployment decision rather than a rewrite. Swapping
 * Daily for LiveKit for a self-hosted SFU is meant to be one file.
 *
 * WHAT REPLACED `LocalPreviewVideoService`
 *
 * That adapter showed the learner their own camera and connected to nobody — correct for designing
 * the classroom, useless for teaching. This one talks to a real room, and the difference that
 * matters is that the ROOM TOKEN IS MINTED SERVER-SIDE. A client that could mint its own token
 * could join any lesson on the platform.
 *
 * THE TOKEN IS FETCHED, NOT CONSTRUCTED
 *
 * The shape of the token is the provider's business. So this asks our own server for it, and the
 * server is the only thing holding the provider's API key. Nothing in this file knows a secret.
 *
 * WHY `joinRoom` TAKES A ROOM AND NOT A LESSON ID
 *
 * Because creating a room and joining one are different permissions. A teacher creates; a learner
 * joins an existing one. Collapsing them would give every learner the ability to open rooms.
 */

import type { VideoRoom, VideoService } from './video-service';

/** What our server returns for a room the caller is allowed to enter. */
interface RoomCredentials {
  /** The provider's room URL. */
  url: string;
  /** A short-lived, per-participant token. Scoped to this room and this person. */
  token: string;
  /** ISO timestamp. Shown so a learner is not surprised mid-lesson. */
  expiresAt: string;
}

async function fetchCredentials(lessonId: string, role: 'teacher' | 'learner'): Promise<RoomCredentials> {
  const response = await fetch('/api/classroom/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonId, role }),
  });

  if (!response.ok) {
    // A 403 means the caller is not on this booking. Saying so plainly is better than a generic
    // failure, because the learner's next step is different — tell their teacher, not retry.
    if (response.status === 403) throw new Error('You are not part of this lesson.');
    if (response.status === 404) throw new Error('That lesson no longer exists.');
    throw new Error('Could not open the classroom.');
  }

  return (await response.json()) as RoomCredentials;
}

/**
 * The managed-provider adapter.
 *
 * It is deliberately thin. Everything a real provider SDK offers beyond `join` and `leave` — the
 * tile grid, chat, breakout rooms — belongs in the UI, and everything that decides WHO may enter
 * belongs on the server. This file owns the stream and nothing else.
 */
export class ManagedVideoService implements VideoService {
  private stream: MediaStream | null = null;
  private credentials: RoomCredentials | null = null;
  private room: VideoRoom | null = null;
  private screenStream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];

  constructor(private readonly role: 'teacher' | 'learner' = 'learner') {}

  /**
   * Create a room for a lesson.
   *
   * Teachers only. A learner calling this gets a 403 from the server, which is the point: the check
   * is not here, because a check in the client is a suggestion.
   */
  async createRoom(lessonId: string): Promise<VideoRoom> {
    const credentials = await fetchCredentials(lessonId, 'teacher');
    return { id: lessonId, token: credentials.token };
  }

  async joinRoom(room: VideoRoom): Promise<void> {
    /*
     * The local camera is requested and the credentials are fetched TOGETHER.
     *
     * Sequentially, a learner who granted camera access and then hit a permission error on the token
     * would be left with a live camera indicator and no classroom — which reads as spyware. Racing
     * them means either both succeed or the camera is released immediately.
     */
    const [credentials] = await Promise.all([
      fetchCredentials(room.id, this.role),
      this.acquireLocalStream(),
    ]);

    this.credentials = credentials;
    this.room = room;

    /*
     * The provider's own client is loaded lazily and only here.
     *
     * A learner reading a dictionary page should not download a WebRTC stack, and importing it at
     * module scope would do exactly that. This is also the single line that changes when the
     * provider changes.
     */
    const { joinRoom } = await import('./video-provider.client');
    await joinRoom({ url: credentials.url, token: credentials.token, stream: this.stream });
  }

  async leaveRoom(): Promise<void> {
    try {
      const { leaveRoom } = await import('./video-provider.client');
      await leaveRoom();
    } catch {
      // The provider may already be gone; the local teardown below still has to happen, or the
      // camera light stays on.
    }

    this.stopLocalTracks(this.screenStream);
    this.screenStream = null;
    this.stopLocalTracks(this.stream);
    this.stream = null;
    this.credentials = null;
    this.room = null;
  }

  async muteMicrophone(): Promise<void> {
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = false));
  }

  async unmuteMicrophone(): Promise<void> {
    this.stream?.getAudioTracks().forEach((track) => (track.enabled = true));
  }

  async enableCamera(): Promise<void> {
    if (this.stream?.getVideoTracks().length) {
      this.stream.getVideoTracks().forEach((track) => (track.enabled = true));
      return;
    }
    // A learner who joined audio-only must be able to turn the camera on later, which means
    // requesting a new track rather than un-muting one that was never acquired.
    await this.acquireLocalStream();
  }

  async disableCamera(): Promise<void> {
    this.stream?.getVideoTracks().forEach((track) => (track.enabled = false));
  }

  /**
   * Screen share, as a separate stream.
   *
   * Kept apart from the camera rather than replacing it, so a teacher can share a slide and still be
   * seen — and so that stopping the share cannot stop the camera.
   */
  async shareScreen(on: boolean): Promise<void> {
    if (!on) {
      this.stopLocalTracks(this.screenStream);
      this.screenStream = null;
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot share a screen.');

    this.screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });

    // The browser's own "Stop sharing" bar ends the track without telling us. Without this the UI
    // would still show "sharing" after the teacher had stopped.
    this.screenStream.getVideoTracks().forEach((track) => {
      track.addEventListener('ended', () => {
        this.screenStream = null;
      });
    });
  }

  /**
   * Recording, using the browser's own recorder.
   *
   * Recorded locally and uploaded afterwards rather than streamed to a recording service, because a
   * lesson recording contains a child's voice and should not pass through a third party unless the
   * consent sheet says it may. The chunks stay in memory until `stopRecording` decides what to do
   * with them.
   */
  async startRecording(): Promise<void> {
    if (!this.stream) throw new Error('Nothing to record.');
    if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record.');

    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: pickMimeType() });
    this.recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    });
    this.recorder.start(1000);
  }

  async stopRecording(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder) return;

    await new Promise<void>((resolve) => {
      recorder.addEventListener('stop', () => resolve(), { once: true });
      recorder.stop();
    });

    this.recorder = null;
    this.chunks = [];
  }

  localStream(): MediaStream | null {
    return this.stream;
  }

  // -------------------------------------------------------------------------

  private stopLocalTracks(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  /**
   * Get a camera and microphone stream, merging rather than replacing.
   *
   * If audio is already held, a second `getUserMedia` for video returns a new stream and the old
   * audio track goes on being captured by nobody — the microphone indicator stays on after the
   * learner has left. So the new tracks are added to the existing stream and the old video track,
   * if any, is stopped.
   */
  private async acquireLocalStream(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device has no camera or microphone.');

    let acquired: MediaStream;
    try {
      acquired = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      /*
       * Permission refused, or no camera. Falling back to audio only is better than failing: a
       * learner on a laptop with a broken webcam can still take the lesson, and the classroom shows
       * their initial instead of a video tile.
       */
      acquired = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    }

    if (!this.stream) {
      this.stream = acquired;
      return;
    }

    for (const track of this.stream.getVideoTracks()) {
      this.stream.removeTrack(track);
      track.stop();
    }
    for (const track of acquired.getTracks()) this.stream.addTrack(track);
  }
}

/** Whatever this browser can actually record. Safari and Chrome disagree, so ask. */
function pickMimeType(): string {
  const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type;
  }
  return '';
}

/**
 * Pick an adapter for the current session.
 *
 * `LocalPreviewVideoService` is still used when there is no server to ask — the preview build and
 * local design work — so the classroom is never simply broken. It is NOT a fallback at runtime: if
 * credentials fail, the error surfaces, because a teacher who believes they are live while talking
 * to nobody is worse off than one who sees an error.
 */
export async function createVideoService(role: 'teacher' | 'learner'): Promise<VideoService> {
  const { LocalPreviewVideoService } = await import('./video-service');
  const previewOnly = import.meta.env['VITE_CLASSROOM_PREVIEW'] === 'true';
  return previewOnly ? new LocalPreviewVideoService() : new ManagedVideoService(role);
}
