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
import CodeInput from './CodeInput';

// Debug logging helper
const DEBUG_P2P = true;
const dlog = (...args: any[]) => {
  if (DEBUG_P2P) console.log('[P2P]', ...args);
};

// WebRTC ICE configuration helper (STUN-only by default, optional TURN via env)
const buildIceServers = (): RTCIceServer[] => {
  const iceServers: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ];

  const turnUrl = import.meta.env.PUBLIC_TURN_URL as string | undefined;
  if (turnUrl) {
    iceServers.push({
      urls: turnUrl,
      username: (import.meta.env.PUBLIC_TURN_USERNAME as string) || undefined,
      credential: (import.meta.env.PUBLIC_TURN_CREDENTIAL as string) || undefined,
    });
  }

  return iceServers;
};

const rtcConfig: RTCConfiguration = {
  iceServers: buildIceServers(),
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
  ...(import.meta.env.PUBLIC_WEBRTC_FORCE_RELAY
    ? { iceTransportPolicy: 'relay' as RTCIceTransportPolicy }
    : {}),
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

interface SignalingMessage {
  type: 'join' | 'joined' | 'offer' | 'answer' | 'ice-candidate' | 'peer-joined' | 'peer-left' | 'error';
  roomCode?: string;
  role?: 'sender' | 'receiver';
  peerId?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  error?: string;
}

export default function P2PFileShareWebRTC() {
  const [mode, setMode] = useState<Mode>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [transferSpeed, setTransferSpeed] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const receivedSizeRef = useRef(0);
  const totalSizeRef = useRef(0);
  const fileNameRef = useRef('');
  const sendingRef = useRef(false);
  const transferStartTimeRef = useRef(0);
  const lastProgressUpdateRef = useRef(0);
  const peerIdRef = useRef('');
  const roomCodeRef = useRef('');
  const roleRef = useRef<'sender' | 'receiver'>('sender');
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Generate unique peer ID
  useEffect(() => {
    peerIdRef.current = `peer-${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  const cleanup = () => {
    dlog('cleanup: starting');

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Close data channel
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }

    // Close peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    // Clear chunks
    chunksRef.current = [];
    receivedSizeRef.current = 0;
    sendingRef.current = false;
    pendingIceCandidatesRef.current = [];

    dlog('cleanup: complete');
  };

  const connectWebSocket = (roomCode: string, role: 'sender' | 'receiver'): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const wsUrl = import.meta.env.PUBLIC_WS_SIGNALING_URL || 'ws://localhost:8080/ws/signaling';
      dlog('Connecting to WebSocket:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      roomCodeRef.current = roomCode;
      roleRef.current = role;

      ws.onopen = () => {
        dlog('WebSocket connected, joining room:', roomCode, 'as', role);
        ws.send(JSON.stringify({
          type: 'join',
          roomCode,
          role,
          peerId: peerIdRef.current
        }));
      };

      ws.onmessage = async (event) => {
        try {
          const message: SignalingMessage = JSON.parse(event.data);
          dlog('WebSocket message:', message.type);

          switch (message.type) {
            case 'joined':
              dlog('Successfully joined room');
              // Create peer connection immediately after joining
              createPeerConnection(role);
              resolve(ws);
              break;
            case 'peer-joined':
              dlog('Peer joined:', message.role);
              if (role === 'sender' && message.role === 'receiver') {
                // Sender creates offer when receiver joins
                await createOffer();
              }
              break;
            case 'offer':
              if (role === 'receiver' && message.sdp) {
                await handleOffer(message.sdp);
              }
              break;
            case 'answer':
              if (role === 'sender' && message.sdp) {
                await handleAnswer(message.sdp);
              }
              break;
            case 'ice-candidate':
              if (message.candidate) {
                await handleIceCandidate(message.candidate);
              }
              break;
            case 'peer-left':
              setError('Peer disconnected');
              cleanup();
              break;
            case 'error':
              setError(message.error || 'Unknown error');
              reject(new Error(message.error));
              break;
          }
        } catch (err) {
          console.error('[P2P] Error handling WebSocket message:', err);
          setError('Failed to process signaling message');
        }
      };

      ws.onerror = (err) => {
        console.error('WebSocket error:', err);
        setError('WebSocket connection failed');
        reject(err);
      };

      ws.onclose = () => {
        dlog('WebSocket closed');
      };
    });
  };

  const flushPendingIceCandidates = async () => {
    const pc = peerConnectionRef.current;
    if (!pc || !pc.remoteDescription) {
      return;
    }

    if (pendingIceCandidatesRef.current.length === 0) {
      return;
    }

    const queuedCandidates = pendingIceCandidatesRef.current.splice(0);
    dlog('Flushing queued ICE candidates:', queuedCandidates.length);

    for (const candidate of queuedCandidates) {
      try {
        dlog('Adding queued ICE candidate:', candidate.candidate?.substring(0, 50) + '...');
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        dlog('Successfully added queued ICE candidate');
      } catch (error) {
        console.error('Failed to add queued ICE candidate:', error, candidate);
      }
    }
  };

  const createPeerConnection = (role: 'sender' | 'receiver') => {
    dlog('Creating peer connection as', role);
    const pc = new RTCPeerConnection(rtcConfig);
    peerConnectionRef.current = pc;
    pendingIceCandidatesRef.current = [];

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        dlog('ICE candidate generated:', event.candidate.candidate);
        dlog('Candidate type:', event.candidate.type, 'Protocol:', event.candidate.protocol);
        if (wsRef.current) {
          dlog('Sending ICE candidate via WebSocket');
          wsRef.current.send(JSON.stringify({
            type: 'ice-candidate',
            roomCode: roomCodeRef.current,
            role: roleRef.current,
            candidate: event.candidate.toJSON()
          }));
        }
      } else {
        dlog('ICE gathering complete (null candidate)');
      }
    };

    pc.onicegatheringstatechange = () => {
      dlog('ICE gathering state:', pc.iceGatheringState);
    };

    pc.onconnectionstatechange = () => {
      dlog('Connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setStatus('Connected!');
      } else if (pc.connectionState === 'failed') {
        setError('P2P connection failed. Please try again.');
        cleanup();
      } else if (pc.connectionState === 'disconnected') {
        setError('P2P connection lost');
        cleanup();
      }
    };

    pc.oniceconnectionstatechange = () => {
      dlog('ICE connection state:', pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.error('ICE connection failed');
        setError('Connection failed. Please try again.');
        cleanup();
      } else if (pc.iceConnectionState === 'disconnected') {
        console.warn('ICE connection disconnected');
      }
    };

    pc.addEventListener('icecandidateerror', (event) => {
      const iceError = event as RTCPeerConnectionIceErrorEvent;
      console.error('ICE candidate error:', iceError?.errorText, iceError?.errorCode, iceError?.url);
    });

    if (role === 'receiver') {
      pc.ondatachannel = (event) => {
        dlog('Data channel received');
        setupDataChannel(event.channel);
      };
    }

    return pc;
  };

  const setupDataChannel = (channel: RTCDataChannel) => {
    dlog('Setting up data channel:', channel.label);
    dataChannelRef.current = channel;
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      dlog('Data channel open');
      setStatus('Connected! Ready to transfer...');

      // If sender, start sending file
      if (roleRef.current === 'sender' && file) {
        sendFileInChunks(file);
      }
    };

    channel.onmessage = (event) => {
      handleDataChannelMessage(event.data);
    };

    channel.onerror = (err) => {
      console.error('Data channel error:', err);
      setError('Data channel error');
    };

    channel.onclose = () => {
      dlog('Data channel closed');
    };
  };

  const createOffer = async () => {
    if (!peerConnectionRef.current || !wsRef.current) return;

    dlog('Creating offer');
    const pc = peerConnectionRef.current;

    // Create data channel (sender creates it)
    const channel = pc.createDataChannel('file-transfer', {
      ordered: true,
      maxRetransmits: 3
    });
    setupDataChannel(channel);

    dlog('Generating offer...');
    const offer = await pc.createOffer();
    dlog('Setting local description...');
    await pc.setLocalDescription(offer);
    dlog('Local description set, ICE gathering state:', pc.iceGatheringState);

    // Wait for ICE gathering to complete to ensure we have candidates in the SDP
    if (pc.iceGatheringState !== 'complete') {
      dlog('Waiting for ICE gathering to complete...');
      await new Promise<void>((resolve) => {
        const checkGathering = () => {
          if (pc.iceGatheringState === 'complete') {
            dlog('ICE gathering completed, sending offer');
            pc.removeEventListener('icegatheringstatechange', checkGathering);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', checkGathering);
        // Timeout after 3 seconds
        setTimeout(() => {
          dlog('ICE gathering timeout, sending offer anyway');
          pc.removeEventListener('icegatheringstatechange', checkGathering);
          resolve();
        }, 3000);
      });
    }

    dlog('Sending offer with SDP');
    wsRef.current.send(JSON.stringify({
      type: 'offer',
      roomCode: roomCodeRef.current,
      sdp: pc.localDescription // Use localDescription which includes gathered candidates
    }));
  };

  const handleOffer = async (sdp: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current || !wsRef.current) return;

    dlog('Handling offer');
    const pc = peerConnectionRef.current;

    dlog('Setting remote description (offer)');
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    dlog('Creating answer...');
    const answer = await pc.createAnswer();
    dlog('Setting local description (answer)');
    await pc.setLocalDescription(answer);
    dlog('Answer set, ICE gathering state:', pc.iceGatheringState);
    await flushPendingIceCandidates();

    // Wait for ICE gathering to complete to ensure we have candidates in the SDP
    if (pc.iceGatheringState !== 'complete') {
      dlog('Waiting for ICE gathering to complete...');
      await new Promise<void>((resolve) => {
        const checkGathering = () => {
          if (pc.iceGatheringState === 'complete') {
            dlog('ICE gathering completed, sending answer');
            pc.removeEventListener('icegatheringstatechange', checkGathering);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', checkGathering);
        // Timeout after 3 seconds
        setTimeout(() => {
          dlog('ICE gathering timeout, sending answer anyway');
          pc.removeEventListener('icegatheringstatechange', checkGathering);
          resolve();
        }, 3000);
      });
    }

    dlog('Sending answer with SDP');
    wsRef.current.send(JSON.stringify({
      type: 'answer',
      roomCode: roomCodeRef.current,
      sdp: pc.localDescription // Use localDescription which includes gathered candidates
    }));
  };

  const handleAnswer = async (sdp: RTCSessionDescriptionInit) => {
    if (!peerConnectionRef.current) return;

    dlog('Handling answer');
    const pc = peerConnectionRef.current;
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    dlog('Remote description set, ICE gathering state:', pc.iceGatheringState);
    dlog('Connection state:', pc.connectionState);
    dlog('ICE connection state:', pc.iceConnectionState);
    await flushPendingIceCandidates();
  };

  const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionRef.current;
    if (!pc) {
      dlog('Cannot add ICE candidate: no peer connection');
      return;
    }

    if (!pc.remoteDescription) {
      dlog('Queueing ICE candidate until remote description is set');
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      dlog('Adding ICE candidate:', candidate.candidate?.substring(0, 50) + '...');
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
      dlog('Successfully added ICE candidate');
    } catch (error) {
      console.error('Failed to add ICE candidate:', error, candidate);
    }
  };

  const updateTransferSpeed = (bytesTransferred: number) => {
    const now = Date.now();
    if (now - lastProgressUpdateRef.current < PROGRESS_UPDATE_INTERVAL) return;

    const elapsed = (now - transferStartTimeRef.current) / 1000; // seconds
    if (elapsed > 0) {
      const speed = bytesTransferred / elapsed; // bytes per second
      setTransferSpeed(speed);
    }
    lastProgressUpdateRef.current = now;
  };

  const sendFileInChunks = async (fileToSend: File) => {
    if (sendingRef.current || !dataChannelRef.current) return;

    sendingRef.current = true;
    transferStartTimeRef.current = Date.now();
    lastProgressUpdateRef.current = Date.now();

    dlog('Sending file:', fileToSend.name, fileToSend.size);

    // Send metadata first
    const metadata: FileMetadata = {
      type: 'file-meta',
      name: fileToSend.name,
      size: fileToSend.size,
    };
    dataChannelRef.current.send(JSON.stringify(metadata));

    let offset = 0;
    const reader = new FileReader();

    const sendNextChunk = () => {
      if (!dataChannelRef.current || dataChannelRef.current.readyState !== 'open') {
        dlog('Data channel closed');
        sendingRef.current = false;
        setError('Connection closed before transfer completed');
        cleanup();
        return;
      }

      // Check backpressure
      if (dataChannelRef.current.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        dlog('Backpressure detected, waiting...');
        setTimeout(sendNextChunk, 100);
        return;
      }

      if (offset >= fileToSend.size) {
        dlog('File send complete');
        sendingRef.current = false;
        setStatus('File sent successfully!');
        setProgress(100);
        notifications.show({
          title: 'Success',
          message: 'File sent successfully!',
          color: 'teal',
          icon: <IconCheck size={16} />,
        });
        return;
      }

      const slice = fileToSend.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = (e) => {
      const result = e.target?.result;
      if (!(result instanceof ArrayBuffer) || !dataChannelRef.current) return;

      const chunk: FileChunk = {
        type: 'file-chunk',
        data: result,
      };

      dataChannelRef.current.send(JSON.stringify(chunk));

      offset += result.byteLength;
      const percent = Math.min(100, (offset / fileToSend.size) * 100);
      setProgress(percent);
      updateTransferSpeed(offset);

      sendNextChunk();
    };

    reader.onerror = () => {
      setError('Error reading file');
      sendingRef.current = false;
      cleanup();
    };

    sendNextChunk();
  };

  const handleDataChannelMessage = (data: any) => {
    if (typeof data === 'string') {
      try {
        const message: FileMessage = JSON.parse(data);

        if (message.type === 'file-meta') {
          dlog('Received file metadata:', message.name, message.size);
          fileNameRef.current = message.name;
          totalSizeRef.current = message.size;
          chunksRef.current = [];
          receivedSizeRef.current = 0;
          transferStartTimeRef.current = Date.now();
          setStatus(`Receiving ${message.name}...`);
          return;
        }

        if (message.type === 'file-chunk' && message.data) {
          handleIncomingChunk(message.data);
          return;
        }
      } catch (e) {
        // Not JSON, might be raw data
      }
    }

    if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
      handleIncomingChunk(data);
    }
  };

  const handleIncomingChunk = (payload: ArrayBuffer | ArrayBufferView) => {
    const chunkArray = payload instanceof ArrayBuffer
      ? new Uint8Array(payload)
      : new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength);

    chunksRef.current.push(chunkArray);
    receivedSizeRef.current += chunkArray.length;

    const percent = totalSizeRef.current > 0
      ? (receivedSizeRef.current / totalSizeRef.current) * 100
      : 0;
    setProgress(percent);
    updateTransferSpeed(receivedSizeRef.current);

    if (totalSizeRef.current > 0 && receivedSizeRef.current >= totalSizeRef.current) {
      completeFileReceive();
    }
  };

  const completeFileReceive = () => {
    dlog('File receive complete');

    const blob = new Blob(chunksRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameRef.current;
    a.click();
    URL.revokeObjectURL(url);

    chunksRef.current = [];
    setStatus('File received successfully!');
    setProgress(100);

    notifications.show({
      title: 'Success',
      message: 'File downloaded successfully!',
      color: 'teal',
      icon: <IconCheck size={16} />,
    });
  };

  const handleSendFile = async (selectedFile: File | null) => {
    if (!selectedFile) return;

    setFile(selectedFile);
    setLoading(true);
    setError(null);
    setStatus('Creating session...');

    try {
      // Create session in backend
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
      if (!res.ok) throw new Error(data?.error || 'Failed to create session');

      const sessionCode = data.code;
      setCode(sessionCode);
      setMode('sending');
      setStatus('Waiting for receiver...');

      // Connect to WebSocket (peer connection created inside on 'joined')
      await connectWebSocket(sessionCode, 'sender');

    } catch (err: any) {
      console.error('Send file error:', err);
      setError(err?.message || 'Failed to initialize transfer');
      cleanup();
    } finally {
      setLoading(false);
    }
  };

  const handleReceiveFile = async (codeToUse: string) => {
    if (!codeToUse || codeToUse.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    setLoading(true);
    setError(null);
    setStatus('Connecting...');

    try {
      // Get session info
      const res = await fetch(`/api/p2p/${codeToUse}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error || 'Session not found');

      fileNameRef.current = data.fileName;
      totalSizeRef.current = data.fileSize;
      setMode('receiving');
      setStatus('Establishing connection...');

      // Connect to WebSocket (peer connection created inside on 'joined')
      await connectWebSocket(codeToUse, 'receiver');

    } catch (err: any) {
      console.error('Receive file error:', err);
      setError(err?.message || 'Failed to connect');
      cleanup();
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    cleanup();
    setMode('idle');
    setFile(null);
    setCode('');
    setInputCode('');
    setProgress(0);
    setStatus('');
    setError(null);
    setTransferSpeed(0);
  };

  const copyCodeToClipboard = () => {
    navigator.clipboard.writeText(code);
    notifications.show({
      title: 'Copied!',
      message: 'Code copied to clipboard',
      color: 'blue',
      icon: <IconCopy size={16} />,
    });
  };

  const formatSpeed = (bytesPerSecond: number) => {
    if (bytesPerSecond < 1024) return `${bytesPerSecond.toFixed(0)} B/s`;
    if (bytesPerSecond < 1024 * 1024) return `${(bytesPerSecond / 1024).toFixed(2)} KB/s`;
    return `${(bytesPerSecond / (1024 * 1024)).toFixed(2)} MB/s`;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  return (
    <Card shadow="sm" padding="lg" radius="md" withBorder>
      <Stack gap="md">
        <Box>
          <Title order={2}>P2P File Transfer</Title>
          <Text size="sm" c="dimmed">
            Share files directly between devices using WebRTC
          </Text>
        </Box>

        <Divider />

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} title="Error" color="red" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {mode === 'idle' && (
          <>
            <Stack gap="md">
              <Box>
                <Text fw={500} mb="xs">Send a File</Text>
                <FileButton onChange={handleSendFile} accept="*/*">
                  {(props) => (
                    <Button
                      {...props}
                      leftSection={<IconUpload size={16} />}
                      variant="filled"
                      fullWidth
                      loading={loading}
                    >
                      Select File to Send
                    </Button>
                  )}
                </FileButton>
              </Box>

              <Divider label="OR" labelPosition="center" />

              <Box>
                <Text fw={500} mb="xs">Receive a File</Text>
                <CodeInput
                  value={inputCode}
                  onChange={setInputCode}
                  onComplete={handleReceiveFile}
                  disabled={loading}
                />
              </Box>
            </Stack>
          </>
        )}

        {mode === 'sending' && (
          <Stack gap="md">
            <Alert icon={<IconUpload size={16} />} title="Sending File" color="blue">
              <Text size="sm" mb="xs">Share this code with the receiver:</Text>
              <Group gap="xs">
                <Badge size="xl" variant="filled" style={{ fontSize: '1.5rem', padding: '1rem' }}>
                  {code}
                </Badge>
                <Button
                  size="xs"
                  variant="light"
                  leftSection={<IconCopy size={14} />}
                  onClick={copyCodeToClipboard}
                >
                  Copy
                </Button>
              </Group>
            </Alert>

            {file && (
              <Box>
                <Text size="sm" fw={500}>File: {file.name}</Text>
                <Text size="xs" c="dimmed">Size: {formatFileSize(file.size)}</Text>
              </Box>
            )}

            {status && (
              <Text size="sm" c="dimmed">{status}</Text>
            )}

            {progress > 0 && (
              <Box>
                <Group justify="apart" mb="xs">
                  <Text size="sm">Progress</Text>
                  <Text size="sm">{progress.toFixed(1)}%</Text>
                </Group>
                <Progress value={progress} size="lg" radius="xl" />
                {transferSpeed > 0 && (
                  <Text size="xs" c="dimmed" mt="xs">
                    Speed: {formatSpeed(transferSpeed)}
                  </Text>
                )}
              </Box>
            )}

            <Button
              leftSection={<IconX size={16} />}
              variant="light"
              color="red"
              onClick={handleCancel}
              fullWidth
            >
              Cancel
            </Button>
          </Stack>
        )}

        {mode === 'receiving' && (
          <Stack gap="md">
            <Alert icon={<IconDownload size={16} />} title="Receiving File" color="green">
              {fileNameRef.current && (
                <>
                  <Text size="sm" fw={500}>{fileNameRef.current}</Text>
                  <Text size="xs" c="dimmed">Size: {formatFileSize(totalSizeRef.current)}</Text>
                </>
              )}
            </Alert>

            {status && (
              <Text size="sm" c="dimmed">{status}</Text>
            )}

            {progress > 0 && (
              <Box>
                <Group justify="apart" mb="xs">
                  <Text size="sm">Progress</Text>
                  <Text size="sm">{progress.toFixed(1)}%</Text>
                </Group>
                <Progress value={progress} size="lg" radius="xl" color="green" />
                {transferSpeed > 0 && (
                  <Text size="xs" c="dimmed" mt="xs">
                    Speed: {formatSpeed(transferSpeed)}
                  </Text>
                )}
              </Box>
            )}

            <Button
              leftSection={<IconX size={16} />}
              variant="light"
              color="red"
              onClick={handleCancel}
              fullWidth
            >
              Cancel
            </Button>
          </Stack>
        )}
      </Stack>
    </Card>
  );
}
