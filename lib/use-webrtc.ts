/**
 * React hook for WebRTC peer connections with Socket.IO signaling
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { Socket } from 'socket.io-client';
import { PeerConnection, getUserMediaStream, stopMediaStream, type RTCConfig } from './webrtc';

export interface UseWebRTCOptions {
  socket: Socket | null;
  channelId: string;
  userId: string;
  isHost: boolean;
  rtcConfig?: RTCConfig;
  mediaConstraints?: MediaStreamConstraints;
}

export function useWebRTC(options: UseWebRTCOptions) {
  const { socket, channelId, userId, isHost, rtcConfig, mediaConstraints } = options;

  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');

  // Initialize local media stream
  const startLocalMedia = useCallback(
    async (constraints: MediaStreamConstraints = mediaConstraints || { audio: true }) => {
      try {
        const stream = await getUserMediaStream(constraints);
        localStreamRef.current = stream;
        return stream;
      } catch (err) {
        throw err;
      }
    },
    [mediaConstraints]
  );

  // Create or get peer connection for a user
  const getPeerConnection = useCallback(
    (peerId: string): PeerConnection => {
      let peer = peersRef.current.get(peerId);
      if (!peer) {
        peer = new PeerConnection(rtcConfig);

        peer.onRemoteStream = (stream) => {
          setRemoteStreams((prev) => new Map(prev).set(peerId, stream));
        };

        peer.onIceCandidate = (candidate) => {
          socket?.emit('webrtc:ice-candidate', {
            channelId,
            from: userId,
            to: peerId,
            candidate: candidate.candidate,
            sdpMLineIndex: candidate.sdpMLineIndex,
            sdpMid: candidate.sdpMid
          });
        };

        peer.onConnectionStateChange = (state) => {
          setConnectionState(state);
        };

        peersRef.current.set(peerId, peer);
      }
      return peer;
    },
    [socket, channelId, userId, rtcConfig]
  );

  // Send offer to peer
  const sendOffer = useCallback(
    async (peerId: string) => {
      const peer = getPeerConnection(peerId);

      if (localStreamRef.current) {
        await peer.addLocalStream(localStreamRef.current);
      }

      const offer = await peer.createOffer();
      socket?.emit('webrtc:offer', {
        channelId,
        from: userId,
        to: peerId,
        offer
      });
    },
    [getPeerConnection, socket, channelId, userId]
  );

  // Handle incoming offer
  const handleOffer = useCallback(
    async (data: {
      from: string;
      offer: RTCSessionDescriptionInit;
    }) => {
      const peer = getPeerConnection(data.from);

      if (localStreamRef.current) {
        await peer.addLocalStream(localStreamRef.current);
      }

      await peer.setRemoteDescription(data.offer);
      const answer = await peer.createAnswer();

      socket?.emit('webrtc:answer', {
        channelId,
        from: userId,
        to: data.from,
        answer
      });
    },
    [getPeerConnection, socket, channelId, userId]
  );

  // Handle incoming answer
  const handleAnswer = useCallback(
    async (data: {
      from: string;
      answer: RTCSessionDescriptionInit;
    }) => {
      const peer = peersRef.current.get(data.from);
      if (peer) {
        await peer.setRemoteDescription(data.answer);
      }
    },
    []
  );

  // Handle ICE candidate
  const handleIceCandidate = useCallback(
    async (data: {
      from: string;
      candidate: string;
      sdpMLineIndex: number | null;
      sdpMid: string | null;
    }) => {
      const peer = peersRef.current.get(data.from);
      if (peer && data.candidate) {
        await peer.addIceCandidate({
          candidate: data.candidate,
          sdpMLineIndex: data.sdpMLineIndex ?? undefined,
          sdpMid: data.sdpMid ?? undefined
        });
      }
    },
    []
  );

  // Setup Socket.IO listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('webrtc:offer', handleOffer);
    socket.on('webrtc:answer', handleAnswer);
    socket.on('webrtc:ice-candidate', handleIceCandidate);

    return () => {
      socket.off('webrtc:offer', handleOffer);
      socket.off('webrtc:answer', handleAnswer);
      socket.off('webrtc:ice-candidate', handleIceCandidate);
    };
  }, [socket, handleOffer, handleAnswer, handleIceCandidate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      localStreamRef.current && stopMediaStream(localStreamRef.current);
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
    };
  }, []);

  return {
    startLocalMedia,
    sendOffer,
    remoteStreams,
    connectionState,
    localStream: localStreamRef.current,
    closePeer: (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (peer) {
        peer.close();
        peersRef.current.delete(peerId);
        setRemoteStreams((prev) => {
          const next = new Map(prev);
          next.delete(peerId);
          return next;
        });
      }
    },
    closeAll: () => {
      localStreamRef.current && stopMediaStream(localStreamRef.current);
      peersRef.current.forEach((peer) => peer.close());
      peersRef.current.clear();
      setRemoteStreams(new Map());
    }
  };
}
