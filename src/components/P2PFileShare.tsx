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
import type { DataConnection, PeerJSOption } from 'peerjs';
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
const getPeerJSConfig = (): PeerJSOption => {
  const config: PeerJSOption = {
    debug: DEBUG_P2P ? 3 : 0, // Max debug level
    config: {
      ...rtcConfig,
      iceServers: [...(rtcConfig.iceServers ?? [])],
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
const PEER_MAX_CONNECT_ATTEMPTS = 4;
const PEER_CONNECT_TIMEOUT = 20000; // ms to wait for a data channel before retrying
const PEER_CONNECT_RETRY_DELAY = 1200; // ms between retry attempts

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

type PeerRole = 'sender' | 'receiver';

interface ConnectAttemptContext {
  aborted: boolean;
  role: PeerRole;
}

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
  const connectAttemptRef = useRef<ConnectAttemptContext | null>(null);
  const receiverConnectTimeoutRef = useRef<number | null>(null);

  const beginConnectAttempt = (role: PeerRole) => {
    const ctx: ConnectAttemptContext = { aborted: false, role };
    connectAttemptRef.current = ctx;
    return ctx;
  };

  const abortConnectAttempts = () => {
    if (connectAttemptRef.current) {
      connectAttemptRef.current.aborted = true;
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      void cleanup();
    };
  }, []);

  // Handle page navigation
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (code && mode === 'sending') {
        void cleanup();
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [code, mode]);

  const cleanup = async () => {
    dlog('cleanup: starting');
    abortConnectAttempts();
    if (receiverConnectTimeoutRef.current !== null) {
      window.clearTimeout(receiverConnectTimeoutRef.current);
      receiverConnectTimeoutRef.current = null;
    }

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
          void cleanup();
          resetToIdle();
        }, 3000);
      }
    };

    reader.onload = (e) => {
      const result = e.target?.result;
      if (!(result instanceof ArrayBuffer)) {
        dlog('sendFileInChunks: unexpected reader result type', typeof result);
        return;
      }

      if (!conn.open) {
        dlog('sendFileInChunks: connection closed before chunk send');
        sendingRef.current = false;
        setError('Connection closed before the file finished uploading');
        void cleanup();
        return;
      }

      const chunk: FileChunk = {
        type: 'file-chunk',
        data: result,
      };

      conn.send(chunk);

      offset += result.byteLength;
      const percent = Math.min(100, (offset / fileToSend.size) * 100);
      setProgress(percent);
      updateTransferSpeed(offset);

      // Continue sending
      sendNextChunk();
    };

    reader.onerror = (err) => {
      console.error('FileReader error:', err);
      reader.abort();
      setError('Failed to read file');
      sendingRef.current = false;
    };

    // Start sending
    sendNextChunk();
  };

  const connectToRemotePeer = (
    peer: Peer,
    remotePeerId: string,
    fileToSend: File,
    ctx: ConnectAttemptContext,
    sessionCode: string,
    unsubscribe?: () => void,
    attempt = 1,
  ): void => {
    if (ctx.aborted || peer.destroyed) {
      dlog('connectToRemotePeer: aborted before starting attempt', { attempt, remotePeerId });
      return;
    }

    const attemptLabel = `${attempt}/${PEER_MAX_CONNECT_ATTEMPTS}`;
    setStatus(`Connecting to receiver... (attempt ${attemptLabel})`);
    dlog('sender: attempting connection', { attempt, remotePeerId });

    const conn = peer.connect(remotePeerId, {
      label: 'p2p-file',
      reliable: true,
      serialization: 'binary',
      metadata: {
        role: ctx.role,
        sessionCode,
        fileName: fileToSend.name,
        fileSize: fileToSend.size,
      },
    });

    connectionRef.current = conn;

    let awaitingOpen = true;
    let timeoutId: number | null = null;
    let peerConnectionDebugTimer: number | null = null;
    let noIceRaf: number | null = null;
    let attachedPcDebug = false;

    const logIceState = (state: string) => {
      console.log('🔵 SENDER: ICE state changed:', state, { attempt });
    };

    const handleIceStateBeforeOpen = (state: string) => {
      logIceState(state);
      if (!awaitingOpen) return;

      if (state === 'failed' || state === 'disconnected' || state === 'closed') {
        awaitingOpen = false;
        clearPreOpenHandlers();
        finalizeFailure(`ice-${state}`);
      }
    };

    const clearPeerConnectionDebug = () => {
      if (peerConnectionDebugTimer !== null) {
        window.clearTimeout(peerConnectionDebugTimer);
        peerConnectionDebugTimer = null;
      }
      if (noIceRaf !== null) {
        window.cancelAnimationFrame(noIceRaf);
        noIceRaf = null;
      }
    };

    const clearPreOpenHandlers = () => {
      conn.off('error', handlePreError);
      conn.off('close', handlePreClose);
      conn.off('iceStateChanged', handleIceStateBeforeOpen);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
      clearPeerConnectionDebug();
    };

    const finalizeFailure = (reason: string, err?: unknown) => {
      if (ctx.aborted) {
        dlog('sender: connection attempt aborted during failure handling', { reason });
        conn.close();
        if (connectionRef.current === conn) {
          connectionRef.current = null;
        }
        return;
      }
      if (connectionRef.current === conn) {
        connectionRef.current = null;
      }

      if (attempt < PEER_MAX_CONNECT_ATTEMPTS) {
        dlog('sender: retrying connection', { nextAttempt: attempt + 1, reason });
        setTimeout(
          () => connectToRemotePeer(peer, remotePeerId, fileToSend, ctx, sessionCode, unsubscribe, attempt + 1),
          PEER_CONNECT_RETRY_DELAY,
        );
        return;
      }

      console.error('🔵 SENDER: Failed to connect after retries', err);
      const failureMessage =
        reason === 'no-ice'
          ? 'No network routes were discovered. Please add a reachable TURN server or loosen firewall restrictions and try again.'
          : 'Unable to connect to the receiver. Please try again.';
      setError(failureMessage);
      notifications.show({
        title: 'Connection failed',
        message: failureMessage,
        color: 'red',
        icon: <IconAlertCircle size={16} />,
      });
      (async () => {
        await cleanup();
        resetToIdle();
        setError(failureMessage);
      })();
    };

    conn.on('iceStateChanged', handleIceStateBeforeOpen);

    const inspectPeerConnection = () => {
      const pc = (conn as any).peerConnection as RTCPeerConnection | undefined;
      if (!pc) {
        console.error('🔵 SENDER: ❌ No peerConnection object created!', { attempt });
        return;
      }

      if (!attachedPcDebug) {
        attachedPcDebug = true;

        pc.addEventListener('icecandidate', (event) => {
          if (event.candidate) {
            console.log('🔵 SENDER: ICE candidate generated:', event.candidate.type, event.candidate.candidate);
          } else {
            console.log('🔵 SENDER: ICE gathering complete (sender)', { attempt });
          }
        });

        pc.addEventListener('icegatheringstatechange', () => {
          console.log('🔵 SENDER: ICE gathering state changed:', pc.iceGatheringState, { attempt });
        });
      }

      console.log('🔵 SENDER: PeerConnection snapshot:', {
        attempt,
        connectionState: pc.connectionState,
        signalingState: pc.signalingState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
      });

      const localCandidates = pc.localDescription
        ? (pc.localDescription.sdp?.match(/a=candidate:/g) || []).length
        : 0;
      const remoteCandidates = pc.remoteDescription
        ? (pc.remoteDescription.sdp?.match(/a=candidate:/g) || []).length
        : 0;

      if (!pc.localDescription) {
        console.log('🔵 SENDER: No local description yet');
      } else {
        console.log('🔵 SENDER: Local SDP candidate count:', localCandidates);
      }

      if (!pc.remoteDescription) {
        console.log('🔵 SENDER: No remote description yet');
      } else {
        console.log('🔵 SENDER: Remote SDP candidate count:', remoteCandidates);
      }

      if (pc.iceGatheringState === 'complete' && localCandidates === 0) {
        // Give the browser one more frame to emit any late "null" candidate before failing.
        noIceRaf = window.requestAnimationFrame(() => {
          const stillPc = (conn as any).peerConnection as RTCPeerConnection | undefined;
          const nowCandidates = stillPc?.localDescription
            ? (stillPc.localDescription.sdp?.match(/a=candidate:/g) || []).length
            : 0;
          if (stillPc && stillPc.iceGatheringState === 'complete' && nowCandidates === 0) {
            console.warn('🔵 SENDER: ICE gathering completed with zero local candidates', { attempt });
            awaitingOpen = false;
            clearPreOpenHandlers();
            conn.close();
            finalizeFailure('no-ice');
          }
        });
      }
    };

    const schedulePeerConnectionInspection = () => {
      inspectPeerConnection();
      peerConnectionDebugTimer = window.setTimeout(schedulePeerConnectionInspection, 3000);
    };

    peerConnectionDebugTimer = window.setTimeout(schedulePeerConnectionInspection, 1500);

    const handlePreError = (err: any) => {
      if (!awaitingOpen) return;
      dlog('sender: connection error before open', { attempt, err });
      awaitingOpen = false;
      clearPreOpenHandlers();
      conn.close();
      finalizeFailure('error', err);
    };

    const handlePreClose = () => {
      if (!awaitingOpen) return;
      dlog('sender: connection closed before open', { attempt });
      awaitingOpen = false;
      clearPreOpenHandlers();
      conn.close();
      finalizeFailure('closed');
    };

    timeoutId = window.setTimeout(() => {
      if (!awaitingOpen) return;
      dlog('sender: connection attempt timed out', { attempt });
      awaitingOpen = false;
      clearPreOpenHandlers();
      conn.close();
      finalizeFailure('timeout');
    }, PEER_CONNECT_TIMEOUT);

    conn.once('open', () => {
      if (ctx.aborted) {
        dlog('sender: connection opened after abort, closing');
        conn.close();
        return;
      }

      awaitingOpen = false;
      clearPreOpenHandlers();
      conn.off('iceStateChanged', handleIceStateBeforeOpen);
      conn.on('iceStateChanged', logIceState);
      if (connectAttemptRef.current === ctx) {
        connectAttemptRef.current = null;
      }

      if (unsubscribe) {
        unsubscribe();
        if (firestoreUnsubscribeRef.current === unsubscribe) {
          firestoreUnsubscribeRef.current = null;
        }
      }

      dlog('sender: connection open', { attempt, remotePeerId });
      setStatus('Connected! Sending file...');
      connectionRef.current = conn;

      conn.on('error', (err) => {
        console.error('🔵 SENDER: Connection error:', err);
        sendingRef.current = false;
        setError('Connection error: ' + (err?.message || 'unknown error'));
        void cleanup();
      });

      conn.on('close', () => {
        console.log('🔵 SENDER: Connection closed');
        dlog('sender: connection closed');
        if (sendingRef.current) {
          setError('Connection closed before transfer completed');
          void cleanup();
        }
      });

      sendFileInChunks(conn, fileToSend);
    });

    conn.on('error', handlePreError);
    conn.on('close', handlePreClose);
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
        const connectCtx = beginConnectAttempt('sender');

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
            if (sessionData?.receiverPeerId && !connectionRef.current && !connectCtx.aborted) {
              console.log('🔵 SENDER: Got receiver peer ID:', sessionData.receiverPeerId);
              dlog('sender: connecting to receiver', sessionData.receiverPeerId);
              connectToRemotePeer(peer, sessionData.receiverPeerId, selectedFile, connectCtx, sessionCode, unsubscribe);
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
        void cleanup();
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
      const connectCtx = beginConnectAttempt('receiver');

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
        if (receiverConnectTimeoutRef.current !== null) {
          window.clearTimeout(receiverConnectTimeoutRef.current);
        }
        receiverConnectTimeoutRef.current = window.setTimeout(() => {
          if (connectCtx.aborted || connectionRef.current) return;
          const timeoutMessage = 'Timed out waiting for the sender to connect';
          dlog('receiver: timed out waiting for sender');
          setError(timeoutMessage);
          (async () => {
            await cleanup();
            resetToIdle();
            setError(timeoutMessage);
          })();
        }, 20000);
      });

      // Listen for incoming connection from sender
      peer.on('connection', (conn) => {
        if (connectCtx.aborted) {
          dlog('receiver: ignoring incoming connection because context aborted');
          conn.close();
          return;
        }
        if (receiverConnectTimeoutRef.current !== null) {
          window.clearTimeout(receiverConnectTimeoutRef.current);
          receiverConnectTimeoutRef.current = null;
        }
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
          if (receiverConnectTimeoutRef.current !== null) {
            window.clearTimeout(receiverConnectTimeoutRef.current);
            receiverConnectTimeoutRef.current = null;
          }
          if (connectAttemptRef.current === connectCtx) {
            connectAttemptRef.current = null;
          }
          setStatus('Connected! Receiving file...');
          transferStartTimeRef.current = Date.now();
          lastProgressUpdateRef.current = Date.now();
        });

        const handleIncomingChunk = (payload: ArrayBuffer | ArrayBufferView) => {
          const chunkArray = payload instanceof ArrayBuffer
            ? new Uint8Array(payload)
            : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);
          chunksRef.current.push(chunkArray);
          receivedSizeRef.current += chunkArray.length;

          const percent = (receivedSizeRef.current / totalSizeRef.current) * 100;
          setProgress(percent);
          updateTransferSpeed(receivedSizeRef.current);

          if (totalSizeRef.current > 0 && receivedSizeRef.current >= totalSizeRef.current) {
            completeFileReceive();
          }
        };

        conn.on('data', (data: any) => {
          if (data && typeof data === 'object' && 'type' in data) {
            const message = data as FileMessage;
            if (message.type === 'file-meta') {
              console.log('🟢 RECEIVER: Received file metadata:', message.name, message.size);
              fileNameRef.current = message.name;
              totalSizeRef.current = message.size;
              chunksRef.current = [];
              receivedSizeRef.current = 0;
              return;
            }

            if (message.type === 'file-chunk' && message.data) {
              handleIncomingChunk(message.data as ArrayBuffer | ArrayBufferView);
              return;
            }
          }

          if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            handleIncomingChunk(data as ArrayBuffer | ArrayBufferView);
            return;
          }

          if (typeof data === 'string') {
            try {
              const parsed = JSON.parse(data) as Partial<FileMetadata>;
              if (parsed?.type === 'file-meta' && parsed.name && typeof parsed.size === 'number') {
                console.log('🟢 RECEIVER: Received metadata (string):', parsed.name, parsed.size);
                fileNameRef.current = parsed.name;
                totalSizeRef.current = parsed.size;
                chunksRef.current = [];
                receivedSizeRef.current = 0;
                return;
              }
            } catch {
              dlog('receiver: failed to parse string payload', data.slice(0, 64));
            }
          }

          console.warn('🟢 RECEIVER: Unhandled data payload', data);
        });

        conn.on('error', (err) => {
          console.error('🟢 RECEIVER: Connection error:', err);
          setError('Connection error: ' + err.message);
          void cleanup();
        });

        conn.on('close', () => {
          console.log('🟢 RECEIVER: Connection closed');
          dlog('receiver: connection closed');
          if (receivedSizeRef.current < totalSizeRef.current) {
            setError('Connection closed before the transfer completed');
            void cleanup();
          }
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
        void cleanup();
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
      void cleanup();
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
    connectAttemptRef.current = null;
    receiverConnectTimeoutRef.current = null;
  };

  const handleCancel = () => {
    void cleanup();
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
