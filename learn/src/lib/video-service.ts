// Provider-independent classroom video interface. The classroom UI only talks
// to VideoService. The real managed provider (and later a self-hosted SFU) is
// plugged in by the backend agent by implementing this interface.

export interface VideoRoom { id: string; token?: string }

export interface VideoService {
  createRoom(lessonId: string): Promise<VideoRoom>;
  joinRoom(room: VideoRoom): Promise<void>;
  leaveRoom(): Promise<void>;
  muteMicrophone(): Promise<void>;
  unmuteMicrophone(): Promise<void>;
  enableCamera(): Promise<void>;
  disableCamera(): Promise<void>;
  shareScreen(on: boolean): Promise<void>;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  localStream(): MediaStream | null;
}

// Local-only adapter for designing the classroom: shows your own camera,
// connects to nobody. Replace with the provider adapter.
export class LocalPreviewVideoService implements VideoService {
  private stream: MediaStream | null = null;
  async createRoom(lessonId: string) { return { id: `preview-${lessonId}` }; }
  async joinRoom() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try { this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true }); } catch { this.stream = null; }
  }
  async leaveRoom() { this.stream?.getTracks().forEach((t) => t.stop()); this.stream = null; }
  async muteMicrophone() { this.stream?.getAudioTracks().forEach((t) => (t.enabled = false)); }
  async unmuteMicrophone() { this.stream?.getAudioTracks().forEach((t) => (t.enabled = true)); }
  async enableCamera() { this.stream?.getVideoTracks().forEach((t) => (t.enabled = true)); }
  async disableCamera() { this.stream?.getVideoTracks().forEach((t) => (t.enabled = false)); }
  async shareScreen() {}
  async startRecording() {}
  async stopRecording() {}
  localStream() { return this.stream; }
}
