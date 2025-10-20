import React, { useState, useEffect, useRef } from 'react';
import {
  Stack,
  Card,
  Text,
  Button,
  Group,
  Progress,
  Badge,
  Alert,
  Box,
  Title,
  Divider,
  FileButton,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import {
  IconUpload,
  IconDownload,
  IconCheck,
  IconAlertCircle,
  IconX,
  IconCopy,
} from '@tabler/icons-react';
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { db } from '../lib/client/firebase';
import { doc, onSnapshot, updateDoc, type Unsubscribe } from 'firebase/firestore';
import CodeInput from './CodeInput';

// Debug logging helper
const DEBUG_P2P = true;
const dlog = (...args: any[]) => {
  if (DEBUG_P2P) console.log('[P2P]', ...args);
};

// WebRTC ICE configuration (STUN + optional TURN via env)
const rtcConfig: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    // Free public TURN servers for better NAT traversal
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    ...(import.meta.env.PUBLIC_TURN_URL
      ? [{
        urls: import.meta.env.PUBLIC_TURN_URL as string,
        username: (import.meta.env.PUBLIC_TURN_USERNAME as string) || undefined,
        credential: (import.meta.env.PUBLIC_TURN_CREDENTIAL as string) || undefined,
      }]
      : []),
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all', // Try all connection types
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  ...(import.meta.env.PUBLIC_WEBRTC_FORCE_RELAY ? { iceTransportPolicy: 'relay' as any } : {}),
};

// PeerJS server configuration helper
const getPeerJSConfig = () => {
  const config: any = {
    debug: DEBUG_P2P ? 3 : 0, // Max debug level
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ],
    },
  };

  // Use custom PeerJS server if configured, otherwise fall back to PeerJS cloud
  if (import.meta.env.PUBLIC_PEERJS_HOST) {
    config.host = import.meta.env.PUBLIC_PEERJS_HOST as string;
    config.port = import.meta.env.PUBLIC_PEERJS_PORT
      ? parseInt(import.meta.env.PUBLIC_PEERJS_PORT as string)
      : 443;
    config.path = (import.meta.env.PUBLIC_PEERJS_PATH as string) || '/';
    config.secure = import.meta.env.PUBLIC_PEERJS_SECURE === 'true' ||
      import.meta.env.PUBLIC_PEERJS_SECURE === true ||
      config.port === 443;

    dlog('Using custom PeerJS server:', {
      host: config.host,
      port: config.port,
      path: config.path,
      secure: config.secure,
    });
  } else {
    dlog('Using default PeerJS cloud server');
  }

  return config;
};

type Mode = 'idle' | 'sending' | 'receiving';

// File transfer constants
const CHUNK_SIZE = 16384; // 16KB chunks (optimal for WebRTC)
const MAX_BUFFERED_AMOUNT = 16 * 1024 * 1024; // 16MB buffer limit for backpressure
const PROGRESS_UPDATE_INTERVAL = 100; // Update UI every 100ms

interface FileMetadata {
  type: 'file-meta';
  name: string;
  size: number;
}

interface FileChunk {
  type: 'file-chunk';
  data: ArrayBuffer;
}

type FileMessage = FileMetadata | FileChunk;

export default function P2PFileShare() {
  const [mode, setMode] = useState<Mode>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferSpeed, setTransferSpeed] = useState(0);

  const peerRef = useRef<Peer | null>(null);
  const connectionRef = useRef<DataConnection | null>(null);
  const firestoreUnsubscribeRef = useRef<Unsubscribe | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const receivedSizeRef = useRef(0);
  const totalSizeRef = useRef(0);
  const fileNameRef = useRef('');
  const lastProgressUpdateRef = useRef(0);
  const transferStartTimeRef = useRef(0);
  const lastTransferredBytesRef = useRef(0);
  const sendingRef = useRef(false);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // Handle page navigation
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (code && mode === 'sending') {
        cleanup();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [code, mode]);

  const cleanup = async () => {
    dlog('cleanup: starting');

    // Unsubscribe from Firestore listener
    if (firestoreUnsubscribeRef.current) {
      firestoreUnsubscribeRef.current();
      firestoreUnsubscribeRef.current = null;
      dlog('cleanup: unsubscribed from Firestore');
    }

    // Close data connection
    if (connectionRef.current) {
      connectionRef.current.close();
      connectionRef.current = null;
      dlog('cleanup: closed data connection');
    }

    // Destroy peer
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
      dlog('cleanup: destroyed peer');
    }

    // Delete session from Firebase if sender
    if (code && mode === 'sending') {
      try {
        await fetch(`/api/p2p/${code}`, { method: 'DELETE' });
        dlog('cleanup: deleted session from Firebase');
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }

    // Clear refs
    chunksRef.current = [];
    receivedSizeRef.current = 0;
    totalSizeRef.current = 0;
    fileNameRef.current = '';
    transferStartTimeRef.current = 0;
    lastTransferredBytesRef.current = 0;
    sendingRef.current = false;
  };

  const updateTransferSpeed = (bytesTransferred: number) => {
    const now = Date.now();
    if (now - lastProgressUpdateRef.current >= PROGRESS_UPDATE_INTERVAL) {
      const elapsed = (now - transferStartTimeRef.current) / 1000; // seconds
      if (elapsed > 0) {
        const speed = bytesTransferred / elapsed; // bytes per second
        setTransferSpeed(speed);
      }
      lastProgressUpdateRef.current = now;
    }
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(1)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Send file with backpressure control
  const sendFileInChunks = async (conn: DataConnection, fileToSend: File) => {
    if (sendingRef.current) {
      dlog('sendFileInChunks: already sending, ignoring');
      return;
    }

    sendingRef.current = true;
    transferStartTimeRef.current = Date.now();
    lastProgressUpdateRef.current = Date.now();

    dlog('sendFileInChunks: starting', { name: fileToSend.name, size: fileToSend.size });

    // Send file metadata first
    const metadata: FileMetadata = {
      type: 'file-meta',
      name: fileToSend.name,
      size: fileToSend.size,
    };
    conn.send(metadata);
    dlog('sendFileInChunks: sent metadata');

    let offset = 0;
    const reader = new FileReader();

    const sendNextChunk = () => {
      if (!conn || conn.open === false) {
        dlog('sendFileInChunks: connection closed, stopping');
        sendingRef.current = false;
        return;
      }

      // Check backpressure - get the underlying data channel
      const dataChannel = (conn as any).dataChannel as RTCDataChannel | undefined;
      if (dataChannel && dataChannel.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        dlog('sendFileInChunks: backpressure detected, bufferedAmount:', dataChannel.bufferedAmount);
        // Wait for buffer to drain
        setTimeout(sendNextChunk, 50);
        return;
      }

      if (offset < fileToSend.size) {
        const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
        reader.readAsArrayBuffer(slice);
      } else {
        // Transfer complete
        dlog('sendFileInChunks: complete');
        setStatus('File sent successfully!');
        setProgress(100);
        sendingRef.current = false;

        notifications.show({
          title: 'Success',
          message: 'File sent successfully!',
          color: 'teal',
          icon: <IconCheck size={16} />,
        });

        setTimeout(() => {
          cleanup();
          resetToIdle();
        }, 3000);
      }
    };

    reader.onload = (e) => {
      if (e.target?.result) {
        const chunk: FileChunk = {
          type: 'file-chunk',
          data: e.target.result as ArrayBuffer,
        };
        conn.send(chunk);

        offset += CHUNK_SIZE;
        const percent = Math.min(100, (offset / fileToSend.size) * 100);
        setProgress(percent);
        updateTransferSpeed(offset);

        // Continue sending
        sendNextChunk();
      }
    };

    reader.onerror = (err) => {
      console.error('FileReader error:', err);
      setError('Failed to read file');
      sendingRef.current = false;
    };

    // Start sending
    sendNextChunk();
  };

  const handleSendFile = async (selectedFile: File | null) => {
    if (!selectedFile) return;

    setFile(selectedFile);
    setLoading(true);
    setError(null);
    setStatus('Creating session...');

    try {
      // Create session in Firebase
      const res = await fetch('/api/p2p/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          fileType: selectedFile.type,
        }),
      });

      const data = await res.json();
      dlog('create: status', res.status, data);
      if (!res.ok) throw new Error(data?.error || 'Failed to create session');

      const sessionCode = data.code;
      setCode(sessionCode);
      dlog('create: got code', sessionCode);
      setMode('sending');
      setStatus('Initializing peer connection...');

      // Initialize PeerJS peer with the session code as peer ID
      const peer = new Peer(sessionCode, getPeerJSConfig());
      peerRef.current = peer;

      peer.on('open', (id) => {
        console.log('🔵 SENDER: Peer opened with ID:', id);
        console.log('🔵 SENDER: Expected ID:', sessionCode);
        console.log('🔵 SENDER: IDs match:', id === sessionCode);
        dlog('sender peer open, id:', id);
        setStatus('Waiting for receiver...');

        // Store peer ID in Firebase for receiver to find
        updateDoc(doc(db, 'p2p-sessions', sessionCode), {
          senderPeerId: id,
          senderConnected: true,
        }).then(() => {
          console.log('🔵 SENDER: Successfully stored peer ID in Firebase');
        }).catch(err => console.error('Failed to update sender peer ID:', err));

        // Listen for receiver peer ID using Firebase realtime listener
        const unsubscribe = onSnapshot(
          doc(db, 'p2p-sessions', sessionCode),
          (snapshot) => {
            const sessionData = snapshot.data();
            if (sessionData?.receiverPeerId && !connectionRef.current) {
              console.log('🔵 SENDER: Got receiver peer ID:', sessionData.receiverPeerId);
              dlog('sender: connecting to receiver', sessionData.receiverPeerId);
              setStatus('Connecting to receiver...');

              // Small delay to ensure peer is fully ready
              setTimeout(() => {
                console.log('🔵 SENDER: Peer state before connect:', {
                  id: peer.id,
                  disconnected: peer.disconnected,
                  destroyed: peer.destroyed,
                });

                // Connect to receiver (sender initiates the connection)
                console.log('🔵 SENDER: Initiating connection to receiver:', sessionData.receiverPeerId);

                // Connect with minimal options - let PeerJS handle defaults
                const conn = peer.connect(sessionData.receiverPeerId);
                connectionRef.current = conn;

                console.log('🔵 SENDER: Connection object created:', {
                  peer: conn.peer,
                  type: conn.type,
                  open: conn.open,
                  metadata: conn.metadata,
                });

                // Monitor the underlying RTCPeerConnection
                setTimeout(() => {
                  const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
                  if (pc) {
                    console.log('🔵 SENDER: ✅ PeerConnection created!');

                    // Check local and remote descriptions for ICE candidates
                    setTimeout(() => {
                      if (pc.localDescription) {
                        const sdp = pc.localDescription.sdp;
                        const candidateCount = (sdp.match(/a=candidate:/g) || []).length;
                        console.log('🔵 SENDER: Local SDP has', candidateCount, 'ICE candidates');
                        if (candidateCount === 0) {
                          console.error('🔵 SENDER: ❌ NO ICE CANDIDATES IN SDP! This is the problem!');
                          console.log('🔵 SENDER: SDP:', sdp.substring(0, 500));
                        }
                      }

                      if (pc.remoteDescription) {
                        const sdp = pc.remoteDescription.sdp;
                        const candidateCount = (sdp.match(/a=candidate:/g) || []).length;
                        console.log('🔵 SENDER: Remote SDP has', candidateCount, 'ICE candidates');
                        if (candidateCount === 0) {
                          console.error('🔵 SENDER: ❌ NO ICE CANDIDATES IN REMOTE SDP!');
                        }
                      }
                    }, 1500);

                    pc.oniceconnectionstatechange = () => {
                      console.log('🔵 SENDER: ICE connection state changed:', pc.iceConnectionState);
                    };

                    pc.onconnectionstatechange = () => {
                      console.log('🔵 SENDER: Connection state changed:', pc.connectionState);
                    };

                    console.log('🔵 SENDER: Initial states:', {
                      connectionState: pc.connectionState,
                      signalingState: pc.signalingState,
                      iceConnectionState: pc.iceConnectionState,
                      iceGatheringState: pc.iceGatheringState,
                    });
                  } else {
                    console.error('🔵 SENDER: ❌ No peerConnection object created!');
                  }
                }, 100);

                conn.on('open', () => {
                  console.log('🔵 SENDER: Connection opened, starting file transfer');
                  dlog('sender: connection open');
                  setStatus('Connected! Sending file...');

                  // Stop listening to Firestore updates
                  unsubscribe();
                  firestoreUnsubscribeRef.current = null;

                  // Start sending file
                  sendFileInChunks(conn, selectedFile);
                });

                conn.on('error', (err) => {
                  console.error('🔵 SENDER: Connection error:', err);
                  setError('Connection error: ' + err.message);
                  cleanup();
                });

                conn.on('close', () => {
                  console.log('🔵 SENDER: Connection closed');
                  dlog('sender: connection closed');
                });

                conn.on('iceStateChanged', (state) => {
                  console.log('🔵 SENDER: ICE state changed:', state);
                });

                // Log the underlying peer connection state
                setTimeout(() => {
                  const pc = (conn as any).peerConnection;
                  console.log('🔵 SENDER: Connection state after 1s:', {
                    open: conn.open,
                    peerConnection: pc?.connectionState,
                    signalingState: pc?.signalingState,
                    iceConnectionState: pc?.iceConnectionState,
                    iceGatheringState: pc?.iceGatheringState,
                  });

                  if (pc) {
                    if (pc.localDescription) {
                      console.log('🔵 SENDER: Has local description (offer)');
                    } else {
                      console.log('🔵 SENDER: NO local description - waiting');
                    }

                    if (pc.remoteDescription) {
                      console.log('🔵 SENDER: Has remote description (answer)');
                    } else {
                      console.log('🔵 SENDER: NO remote description yet');
                    }
                  }
                }, 1000);
              }, 300); // End of setTimeout for connection delay
            }
          },
          (error) => {
            console.error('🔵 SENDER: Firestore listener error:', error);
            setError('Failed to listen for receiver: ' + error.message);
          }
        );

        firestoreUnsubscribeRef.current = unsubscribe;
      });

      peer.on('error', (err) => {
        console.error('🔵 SENDER: Peer error:', err);
        console.error('🔵 SENDER: Error type:', err.type);
        setError('Peer error: ' + err.message);
        cleanup();
      });

      peer.on('disconnected', () => {
        console.log('🔵 SENDER: Peer disconnected');
        dlog('sender: peer disconnected');
      });

      peer.on('close', () => {
        console.log('🔵 SENDER: Peer closed');
      });

      notifications.show({
        title: 'Session Created',
        message: `Share code ${sessionCode} with the receiver`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to create session');
      notifications.show({
        title: 'Error',
        message: err?.message || 'Failed to create session',
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleReceiveFile = async (codeParam?: string) => {
    const codeToUse = codeParam || inputCode;
    if (!codeToUse || codeToUse.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus('Connecting...');
    setCode(codeToUse);

    try {
      // Get session info
      const res = await fetch(`/api/p2p/${codeToUse}`);
      const data = await res.json();
      dlog('receiver GET session', res.status, data);

      if (!res.ok) throw new Error(data?.error || 'Session not found');

      fileNameRef.current = data.fileName;
      totalSizeRef.current = data.fileSize;
      dlog('receiver got metadata', { fileName: data.fileName, size: data.fileSize });
      setMode('receiving');
      setStatus('Initializing peer connection...');

      // Initialize PeerJS peer
      const peer = new Peer(getPeerJSConfig());
      peerRef.current = peer;

      peer.on('open', (myPeerId) => {
        console.log('🟢 RECEIVER: Peer opened with ID:', myPeerId);
        dlog('receiver peer open, id:', myPeerId);

        // Update Firebase with receiver peer ID
        updateDoc(doc(db, 'p2p-sessions', codeToUse), {
          receiverPeerId: myPeerId,
          receiverConnected: true,
        }).then(() => {
          console.log('🟢 RECEIVER: Successfully stored peer ID in Firebase');
        }).catch(err => console.error('Failed to update receiver peer ID:', err));

        // Wait for sender to connect
        setStatus('Waiting for sender to connect...');
      });

      // Listen for incoming connection from sender
      peer.on('connection', (conn) => {
        console.log('🟢 RECEIVER: Incoming connection from sender');
        console.log('🟢 RECEIVER: Connection details:', {
          peer: conn.peer,
          open: conn.open,
          type: conn.type,
          reliable: (conn as any).reliable,
        });
        dlog('receiver: incoming connection');
        connectionRef.current = conn;

        // Monitor the underlying RTCPeerConnection
        setTimeout(() => {
          const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
          if (pc) {
            console.log('🟢 RECEIVER: ✅ PeerConnection exists!');

            // Add ICE candidate listener to debug
            pc.onicecandidate = (event) => {
              if (event.candidate) {
                console.log('🟢 RECEIVER: ICE candidate generated:', event.candidate.type, event.candidate.candidate);
              } else {
                console.log('🟢 RECEIVER: ICE gathering complete');
              }
            };

            pc.oniceconnectionstatechange = () => {
              console.log('🟢 RECEIVER: ICE connection state changed:', pc.iceConnectionState);
            };

            pc.onicegatheringstatechange = () => {
              console.log('🟢 RECEIVER: ICE gathering state changed:', pc.iceGatheringState);
            };

            pc.onconnectionstatechange = () => {
              console.log('🟢 RECEIVER: Connection state changed:', pc.connectionState);
            };

            console.log('🟢 RECEIVER: Initial states:', {
              connectionState: pc.connectionState,
              signalingState: pc.signalingState,
              iceConnectionState: pc.iceConnectionState,
              iceGatheringState: pc.iceGatheringState,
            });
          } else {
            console.error('🟢 RECEIVER: ❌ No peerConnection object!');
          }
        }, 100);

        conn.on('open', () => {
          console.log('🟢 RECEIVER: Connection opened');
          dlog('receiver: connection open');
          setStatus('Connected! Receiving file...');
          transferStartTimeRef.current = Date.now();
          lastProgressUpdateRef.current = Date.now();
        });

        conn.on('data', (data: any) => {
          const message = data as FileMessage;

          if (message.type === 'file-meta') {
            // Received file metadata
            console.log('🟢 RECEIVER: Received file metadata:', message.name, message.size);
            fileNameRef.current = message.name;
            totalSizeRef.current = message.size;
            chunksRef.current = [];
            receivedSizeRef.current = 0;
          } else if (message.type === 'file-chunk') {
            // Received file chunk
            const chunk = new Uint8Array(message.data);
            chunksRef.current.push(chunk);
            receivedSizeRef.current += chunk.length;

            const percent = (receivedSizeRef.current / totalSizeRef.current) * 100;
            setProgress(percent);
            updateTransferSpeed(receivedSizeRef.current);

            if (receivedSizeRef.current >= totalSizeRef.current) {
              completeFileReceive();
            }
          }
        });

        conn.on('error', (err) => {
          console.error('🟢 RECEIVER: Connection error:', err);
          setError('Connection error: ' + err.message);
          cleanup();
        });

        conn.on('close', () => {
          console.log('🟢 RECEIVER: Connection closed');
          dlog('receiver: connection closed');
        });

        conn.on('iceStateChanged', (state) => {
          console.log('🟢 RECEIVER: ICE state changed:', state);
        });

        // Log the underlying peer connection state
        setTimeout(() => {
          const pc = (conn as any).peerConnection;
          console.log('🟢 RECEIVER: Connection state after 1s:', {
            open: conn.open,
            peerConnection: pc?.connectionState,
            signalingState: pc?.signalingState,
            iceConnectionState: pc?.iceConnectionState,
            iceGatheringState: pc?.iceGatheringState,
          });

          if (pc) {
            if (pc.localDescription) {
              console.log('🟢 RECEIVER: Has local description (answer)');
            } else {
              console.log('🟢 RECEIVER: NO local description yet');
            }

            if (pc.remoteDescription) {
              console.log('🟢 RECEIVER: Has remote description (offer)');
            } else {
              console.log('🟢 RECEIVER: NO remote description - waiting');
            }
          }
        }, 1000);
      });

      peer.on('error', (err) => {
        console.error('🟢 RECEIVER: Peer error:', err);
        console.error('🟢 RECEIVER: Error type:', err.type);
        setError('Peer error: ' + err.message);
        cleanup();
      });

      peer.on('close', () => {
        console.log('🟢 RECEIVER: Peer closed');
      });

      peer.on('disconnected', () => {
        console.log('🟢 RECEIVER: Peer disconnected');
        dlog('receiver: peer disconnected');
      });

      notifications.show({
        title: 'Connecting',
        message: 'Establishing connection with sender...',
        color: 'blue',
        icon: <IconDownload size={16} />,
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to connect');
      setMode('idle');
      setCode('');
      notifications.show({
        title: 'Error',
        message: err?.message || 'Failed to connect',
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
    } finally {
      setLoading(false);
    }
  };

  // Stream-based file download to avoid memory buildup
  const completeFileReceive = () => {
    dlog('completeFileReceive: starting', { chunks: chunksRef.current.length, size: receivedSizeRef.current });

    // Create blob from chunks using streaming
    const blob = new Blob(chunksRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameRef.current;
    a.click();
    URL.revokeObjectURL(url);

    // Clear chunks immediately to free memory
    chunksRef.current = [];

    setStatus('File received successfully!');
    setProgress(100);

    notifications.show({
      title: 'Success',
      message: 'File downloaded successfully!',
      color: 'teal',
      icon: <IconCheck size={16} />,
    });

    setTimeout(() => {
      cleanup();
      resetToIdle();
    }, 3000);
  };

  const resetToIdle = () => {
    setMode('idle');
    setFile(null);
    setCode('');
    setInputCode('');
    setProgress(0);
    setStatus('');
    setError(null);
    setTransferSpeed(0);
  };

  const handleCancel = () => {
    cleanup();
    resetToIdle();
  };

  const copyCodeToClipboard = () => {
    navigator.clipboard.writeText(code);
    notifications.show({
      title: 'Copied',
      message: 'Code copied to clipboard',
      color: 'blue',
      icon: <IconCopy size={16} />,
    });
  };

  return (
    <Stack gap="md">
      <Card shadow="sm" padding="lg" radius="md" withBorder>
        <Stack gap="md">
          <Group justify="space-between">
            <Title order={3}>P2P File Transfer</Title>
            {mode !== 'idle' && (
              <Badge color={mode === 'sending' ? 'blue' : 'green'} size="lg">
                {mode === 'sending' ? 'Sending' : 'Receiving'}
              </Badge>
            )}
          </Group>

          {error && (
            <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {mode === 'idle' && (
            <>
              <Divider label="Send a file" labelPosition="center" />
              <FileButton onChange={handleSendFile} accept="*/*">
                {(props) => (
                  <Button
                    {...props}
                    leftSection={<IconUpload size={16} />}
                    variant="filled"
                    size="lg"
                    fullWidth
                    loading={loading}
                  >
                    Select File to Send
                  </Button>
                )}
              </FileButton>

              <Divider label="Or receive a file" labelPosition="center" />
              <Stack gap="sm">
                <CodeInput
                  value={inputCode}
                  onChange={setInputCode}
                  onComplete={handleReceiveFile}
                  disabled={loading}
                />
                <Button
                  leftSection={<IconDownload size={16} />}
                  onClick={() => handleReceiveFile()}
                  disabled={inputCode.length !== 6}
                  loading={loading}
                  variant="light"
                  size="lg"
                  fullWidth
                >
                  Receive File
                </Button>
              </Stack>
            </>
          )}

          {mode === 'sending' && (
            <Stack gap="md">
              <Box>
                <Text size="sm" c="dimmed">
                  File to send:
                </Text>
                <Text fw={500}>{file?.name}</Text>
                <Text size="sm" c="dimmed">
                  {file && formatFileSize(file.size)}
                </Text>
              </Box>

              <Box>
                <Text size="sm" c="dimmed" mb={4}>
                  Share this code with the receiver:
                </Text>
                <Group gap="xs">
                  <Badge size="xl" variant="filled" color="blue" style={{ fontSize: '1.5rem', padding: '1rem' }}>
                    {code}
                  </Badge>
                  <Button size="sm" variant="light" onClick={copyCodeToClipboard} leftSection={<IconCopy size={14} />}>
                    Copy
                  </Button>
                </Group>
              </Box>

              {status && (
                <Text size="sm" c="dimmed">
                  {status}
                </Text>
              )}

              {progress > 0 && (
                <>
                  <Progress value={progress} size="lg" radius="xl" animated />
                  <Group justify="space-between">
                    <Text size="sm">{progress.toFixed(1)}%</Text>
                    {transferSpeed > 0 && <Text size="sm">{formatSpeed(transferSpeed)}</Text>}
                  </Group>
                </>
              )}

              <Button
                leftSection={<IconX size={16} />}
                onClick={handleCancel}
                variant="light"
                color="red"
                fullWidth
              >
                Cancel
              </Button>
            </Stack>
          )}

          {mode === 'receiving' && (
            <Stack gap="md">
              <Box>
                <Text size="sm" c="dimmed">
                  Session code:
                </Text>
                <Badge size="lg" variant="filled" color="green">
                  {code}
                </Badge>
              </Box>

              {fileNameRef.current && (
                <Box>
                  <Text size="sm" c="dimmed">
                    Receiving file:
                  </Text>
                  <Text fw={500}>{fileNameRef.current}</Text>
                  <Text size="sm" c="dimmed">
                    {formatFileSize(totalSizeRef.current)}
                  </Text>
                </Box>
              )}

              {status && (
                <Text size="sm" c="dimmed">
                  {status}
                </Text>
              )}

              {progress > 0 && (
                <>
                  <Progress value={progress} size="lg" radius="xl" animated />
                  <Group justify="space-between">
                    <Text size="sm">{progress.toFixed(1)}%</Text>
                    {transferSpeed > 0 && <Text size="sm">{formatSpeed(transferSpeed)}</Text>}
                  </Group>
                </>
              )}

              <Button
                leftSection={<IconX size={16} />}
                onClick={handleCancel}
                variant="light"
                color="red"
                fullWidth
              >
                Cancel
              </Button>
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}

