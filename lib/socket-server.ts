import { Server as SocketIOServer, Socket } from 'socket.io';
import type { Server as HTTPServer } from 'http';
import { logger } from './logger';

export interface FileTransferState {
  chunks: Map<string, Uint8Array[]>;
  metadata: Map<string, { filename: string; mimeType: string; totalSize: number; channelId: string; userId: string }>;
}

const fileTransferState: FileTransferState = {
  chunks: new Map(),
  metadata: new Map()
};

export function initializeSocketIO(httpServer: HTTPServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.NODE_ENV === 'production' 
        ? ['https://sync-share-alpha.vercel.app', 'https://syncshare.app']
        : ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io'
  });

  io.on('connection', (socket: Socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    // Handle file chunk upload from host
    socket.on('file:start', (data: {
      transferId: string;
      filename: string;
      mimeType: string;
      totalSize: number;
      channelId: string;
      userId: string;
    }) => {
      logger.info('File upload started', { transferId: data.transferId, userId: data.userId });
      
      fileTransferState.chunks.set(data.transferId, []);
      fileTransferState.metadata.set(data.transferId, {
        filename: data.filename,
        mimeType: data.mimeType,
        totalSize: data.totalSize,
        channelId: data.channelId,
        userId: data.userId
      });

      socket.emit('file:start:ack', { transferId: data.transferId, ok: true });
    });

    // Handle file chunk from host
    socket.on('file:chunk', (data: { transferId: string; chunk: ArrayBuffer; chunkIndex: number }) => {
      const chunks = fileTransferState.chunks.get(data.transferId);
      if (!chunks) {
        socket.emit('file:chunk:error', { transferId: data.transferId, error: 'Transfer not found' });
        return;
      }

      chunks[data.chunkIndex] = new Uint8Array(data.chunk);
      socket.emit('file:chunk:ack', { transferId: data.transferId, chunkIndex: data.chunkIndex, ok: true });
    });

    // Handle file complete
    socket.on('file:complete', (data: { transferId: string; channelId: string }) => {
      const chunks = fileTransferState.chunks.get(data.transferId);
      const metadata = fileTransferState.metadata.get(data.transferId);

      if (!chunks || !metadata) {
        socket.emit('file:complete:error', { transferId: data.transferId, error: 'Transfer not found' });
        return;
      }

      // Combine chunks into single blob
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Create blob and data URL
      const blob = new Blob([combined], { type: metadata.mimeType });
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        
        // Broadcast to all clients in the channel
        io.to(`channel:${metadata.channelId}`).emit('file:ready', {
          transferId: data.transferId,
          dataUrl,
          filename: metadata.filename,
          mimeType: metadata.mimeType,
          sourceMode: 'local'
        });

        // Cleanup
        fileTransferState.chunks.delete(data.transferId);
        fileTransferState.metadata.delete(data.transferId);

        socket.emit('file:complete:ack', { transferId: data.transferId, ok: true });
      };
      reader.readAsDataURL(blob);
    });

    // Join channel room
    socket.on('channel:join', (data: { channelId: string; userId: string }) => {
      socket.join(`channel:${data.channelId}`);
      logger.info('User joined channel room', { userId: data.userId, channelId: data.channelId });
    });

    // Leave channel room
    socket.on('channel:leave', (data: { channelId: string; userId: string }) => {
      socket.leave(`channel:${data.channelId}`);
      logger.info('User left channel room', { userId: data.userId, channelId: data.channelId });
    });

    // Host moderation: force mute/unmute a participant.
    socket.on('voice:mute-user', (data: { channelId: string; from: string; to: string; muted: boolean }) => {
      if (!data?.to) return;
      io.to(`user:${data.to}`).emit('voice:force-mute', {
        channelId: data.channelId,
        target: data.to,
        muted: Boolean(data.muted),
        by: data.from
      });
    });

    // Disconnect
    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { socketId: socket.id });
    });
  });

  return io;
}

export default fileTransferState;
