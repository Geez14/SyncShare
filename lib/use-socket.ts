import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';

let globalSocket: Socket | null = null;

export function useSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!globalSocket) {
      const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3000';
      globalSocket = io(socketUrl, {
        path: '/socket.io',
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5
      });

      globalSocket.on('connect', () => setIsConnected(true));
      globalSocket.on('disconnect', () => setIsConnected(false));
    }

    socketRef.current = globalSocket;
    return () => {
      // Don't disconnect global socket, keep it alive
    };
  }, []);

  return { socket: socketRef.current, isConnected };
}

export interface FileUploadProgress {
  transferId: string;
  totalChunks: number;
  uploadedChunks: number;
  filename: string;
}

const CHUNK_SIZE = 64 * 1024; // 64 KB chunks

export async function uploadFileViaSocket(
  socket: Socket,
  file: File,
  channelId: string,
  userId: string,
  onProgress?: (progress: FileUploadProgress) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const transferId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    // Wait for acknowledgment before sending chunks
    socket.once(`file:start:ack`, (data: { transferId: string; ok: boolean }) => {
      if (!data.ok) {
        reject(new Error('File transfer rejected by server'));
        return;
      }

      // Read and send file in chunks
      const reader = new FileReader();
      let chunkIndex = 0;

      const readNextChunk = () => {
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const blob = file.slice(start, end);
        reader.readAsArrayBuffer(blob);
      };

      reader.onload = (e) => {
        const chunk = e.target?.result as ArrayBuffer;
        
        socket.emit('file:chunk', {
          transferId,
          chunk,
          chunkIndex
        });

        // Wait for ack before sending next chunk
        socket.once(`file:chunk:ack`, (ack: { transferId: string; chunkIndex: number; ok: boolean }) => {
          if (ack.ok) {
            chunkIndex++;
            onProgress?.({
              transferId,
              totalChunks,
              uploadedChunks: chunkIndex,
              filename: file.name
            });

            if (chunkIndex >= totalChunks) {
              // All chunks sent, notify server we're done
              socket.emit('file:complete', { transferId, channelId });
            } else {
              readNextChunk();
            }
          } else {
            reject(new Error(`Chunk upload failed at index ${chunkIndex}`));
          }
        });
      };

      reader.onerror = () => {
        reject(new Error('Failed to read file'));
      };

      readNextChunk();
    });

    // Start the transfer
    socket.emit('file:start', {
      transferId,
      filename: file.name,
      mimeType: file.type,
      totalSize: file.size,
      channelId,
      userId
    });

    // Set up listener for when file is ready
    const onFileReady = (data: {
      transferId: string;
      dataUrl: string;
      filename: string;
      mimeType: string;
      sourceMode: string;
    }) => {
      if (data.transferId === transferId) {
        socket.off('file:ready', onFileReady);
        resolve(data.dataUrl);
      }
    };

    socket.on('file:ready', onFileReady);
  });
}
