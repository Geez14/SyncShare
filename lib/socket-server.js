/**
 * Socket.IO server initialization (JavaScript version)
 */
const { Server: SocketIOServer } = require('socket.io');
const { logger } = require('./logger');

const fileTransferState = {
  chunks: new Map(),
  metadata: new Map()
};

function initializeSocketIO(httpServer) {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin:
        process.env.NODE_ENV === 'production'
          ? ['https://sync-share-alpha.vercel.app', 'https://syncshare.app']
          : ['http://localhost:3000', 'http://localhost:3001'],
      methods: ['GET', 'POST'],
      credentials: true
    },
    transports: ['websocket', 'polling'],
    path: '/socket.io'
  });

  io.on('connection', (socket) => {
    logger.info('Socket connected', { socketId: socket.id });

    // Handle file chunk upload from host
    socket.on('file:start', (data) => {
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
    socket.on('file:chunk', (data) => {
      const chunks = fileTransferState.chunks.get(data.transferId);
      if (!chunks) {
        socket.emit('file:chunk:error', { transferId: data.transferId, error: 'Transfer not found' });
        return;
      }

      chunks[data.chunkIndex] = new Uint8Array(data.chunk);
      socket.emit('file:chunk:ack', { transferId: data.transferId, chunkIndex: data.chunkIndex, ok: true });
    });

    // Handle file complete
    socket.on('file:complete', (data) => {
      const chunks = fileTransferState.chunks.get(data.transferId);
      const metadata = fileTransferState.metadata.get(data.transferId);

      if (!chunks || !metadata) {
        socket.emit('file:complete:error', { transferId: data.transferId, error: 'Transfer not found' });
        return;
      }

      // Combine chunks into single blob
      const totalLength = chunks.reduce((sum, chunk) => sum + (chunk ? chunk.length : 0), 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        if (chunk) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
      }

      // Create blob and convert to data URL via BufferUtil
      const blob = Buffer.concat([combined]);
      const dataUrl = `data:${metadata.mimeType};base64,${blob.toString('base64')}`;

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
    });

    // Handle WebRTC offer
    socket.on('webrtc:offer', (data) => {
      logger.debug('WebRTC offer relayed', { from: data.from, to: data.to });
      io.to(`user:${data.to}`).emit('webrtc:offer', {
        from: data.from,
        offer: data.offer
      });
    });

    // Handle WebRTC answer
    socket.on('webrtc:answer', (data) => {
      logger.debug('WebRTC answer relayed', { from: data.from, to: data.to });
      io.to(`user:${data.to}`).emit('webrtc:answer', {
        from: data.from,
        answer: data.answer
      });
    });

    // Handle ICE candidate
    socket.on('webrtc:ice-candidate', (data) => {
      io.to(`user:${data.to}`).emit('webrtc:ice-candidate', {
        from: data.from,
        candidate: data.candidate,
        sdpMLineIndex: data.sdpMLineIndex,
        sdpMid: data.sdpMid
      });
    });

    // Host moderation: force mute/unmute a participant.
    socket.on('voice:mute-user', (data) => {
      if (!data?.to) return;
      io.to(`user:${data.to}`).emit('voice:force-mute', {
        channelId: data.channelId,
        target: data.to,
        muted: Boolean(data.muted),
        by: data.from
      });
    });

    // Join user room for targeted messaging
    socket.on('user:ready', (data) => {
      socket.join(`user:${data.userId}`);
      logger.info('User ready for signaling', { userId: data.userId, channelId: data.channelId });
    });

    // Disconnect
    socket.on('disconnect', () => {
      logger.info('Socket disconnected', { socketId: socket.id });
    });
  });

  return io;
}

module.exports = { initializeSocketIO, fileTransferState };
