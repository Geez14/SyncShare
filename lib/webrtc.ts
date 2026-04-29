/**
 * WebRTC Peer Connection Manager
 * Handles RTCPeerConnection lifecycle, offer/answer, and ICE candidates
 */

export interface RTCConfig {
  iceServers?: RTCIceServer[];
}

export class PeerConnection {
  pc: RTCPeerConnection;
  remoteStream: MediaStream | null = null;
  localStream: MediaStream | null = null;
  onRemoteStream?: (stream: MediaStream) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
  onConnectionStateChange?: (state: RTCPeerConnectionState) => void;
  onTrackAdded?: (event: RTCTrackEvent) => void;

  constructor(config: RTCConfig = {}) {
    const peerConfig: RTCConfiguration = {
      iceServers: config.iceServers || [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    this.pc = new RTCPeerConnection(peerConfig);

    // Track ICE candidates
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.onIceCandidate?.(event.candidate);
      }
    };

    // Track connection state changes
    this.pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(this.pc.connectionState);
    };

    // Track remote stream
    this.pc.ontrack = (event) => {
      this.remoteStream = event.streams[0];
      this.onRemoteStream?.(event.streams[0]);
      this.onTrackAdded?.(event);
    };
  }

  async addLocalStream(stream: MediaStream) {
    this.localStream = stream;
    stream.getTracks().forEach((track) => {
      this.pc.addTrack(track, stream);
    });
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(desc));
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore invalid or late ICE candidates.
    }
  }

  close() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
    }
    this.pc.close();
  }

  getConnectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }
}

export async function getUserMediaStream(
  constraints: MediaStreamConstraints = { audio: true, video: false }
): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    throw new Error(`Failed to get media: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function stopMediaStream(stream: MediaStream | null) {
  if (!stream) return;
  stream.getTracks().forEach((track) => {
    track.stop();
  });
}
