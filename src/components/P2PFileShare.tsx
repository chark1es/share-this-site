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
import SimplePeer from 'simple-peer';
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
    ...(import.meta.env.PUBLIC_TURN_URL
      ? [{
        urls: import.meta.env.PUBLIC_TURN_URL as string,
        username: (import.meta.env.PUBLIC_TURN_USERNAME as string) || undefined,
        credential: (import.meta.env.PUBLIC_TURN_CREDENTIAL as string) || undefined,
      }]
      : []),
  ],
  iceCandidatePoolSize: 2,
  ...(import.meta.env.PUBLIC_WEBRTC_FORCE_RELAY ? { iceTransportPolicy: 'relay' as any } : {}),
};

type Mode = 'idle' | 'sending' | 'receiving';

export default function P2PFileShare() {
  const [mode, setMode] = useState<Mode>('idle');
  const [file, setFile] = useState<File | null>(null);
  const [code, setCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const chunksRef = useRef<Uint8Array[]>([]);
  const receivedSizeRef = useRef(0);
  const totalSizeRef = useRef(0);
  const fileNameRef = useRef('');

  // Cleanup on unmount or when mode changes
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, []);

  // Handle page navigation (avoid deleting session on simple tab visibility changes)
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
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    if (code && mode === 'sending') {
      try {
        await fetch(`/api/p2p/${code}`, { method: 'DELETE' });
      } catch (err) {
        console.error('Cleanup error:', err);
      }
    }

    chunksRef.current = [];
    receivedSizeRef.current = 0;
    totalSizeRef.current = 0;
    fileNameRef.current = '';
  };

  const handleSendFile = async (selectedFile: File | null) => {
    if (!selectedFile) return;

    setFile(selectedFile);
    setLoading(true);
    setError(null);
    setStatus('Creating session...');

    try {
      // Create P2P session
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

      setCode(data.code);
      dlog('create: got code', data.code);
      setMode('sending');
      setStatus('Waiting for receiver...');

      // Initialize WebRTC peer as initiator
      // NOTE: We use trickle: false because SimplePeer v9 doesn't properly emit ICE candidates
      // with trickle: true for data-only connections. With trickle: false, all ICE candidates
      // are embedded in the offer/answer SDP, which is more reliable.
      const peer = new SimplePeer({
        initiator: true,
        trickle: false,  // Changed from true - see note above
        config: rtcConfig
      });
      peerRef.current = peer;
      // ICE state diagnostics
      try {
        (peer as any).on?.('iceStateChange', (s: string) => dlog('sender iceStateChange', s));
        const pc = (peer as any)._pc as RTCPeerConnection | undefined;
        if (pc) {
          pc.addEventListener('iceconnectionstatechange', () => {
            console.log('🔵 SENDER iceConnectionState:', pc.iceConnectionState);
            dlog('sender iceConnectionState', pc.iceConnectionState);
          });
          pc.addEventListener('icegatheringstatechange', () => {
            console.log('🔵 SENDER iceGatheringState:', pc.iceGatheringState);
            dlog('sender iceGatheringState', pc.iceGatheringState);
          });
          pc.addEventListener('connectionstatechange', () => {
            console.log('🔵 SENDER connectionState:', pc.connectionState);
            dlog('sender connectionState', pc.connectionState);

            // Handle connection failures
            if (pc.connectionState === 'failed') {
              console.error('❌ SENDER: Connection failed');
              setError('Connection failed - please try again');
              cleanup();
            }
          });
          pc.addEventListener('icecandidateerror', (e: any) => {
            console.error('❌ SENDER icecandidateerror:', e?.url, e?.errorCode, e?.errorText);
            dlog('sender icecandidateerror', e?.url, e?.errorCode, e?.errorText);
          });

          // Monitor ICE candidates for debugging (with trickle: false, these are embedded in SDP)
          let senderIceCandidateCount = 0;
          pc.addEventListener('icecandidate', (e: RTCPeerConnectionIceEvent) => {
            if (e.candidate) {
              senderIceCandidateCount++;
              console.log(`🧊 SENDER ICE candidate #${senderIceCandidateCount}:`, e.candidate.candidate);
              dlog('sender icecandidate #', senderIceCandidateCount, e.candidate.candidate);
            } else {
              console.log(`✅ SENDER ICE gathering complete (${senderIceCandidateCount} candidates)`);
              dlog('sender ICE gathering complete, total candidates:', senderIceCandidateCount);
            }
          });
        }
      } catch (e) {
        console.error('Failed to setup ICE monitoring:', e);
      }


      let offerSent = false;

      peer.on('signal', async (signal) => {
        try {
          const signalType = (signal as any).type;
          console.log('🔵 SENDER signal event:', signalType);

          // Count ICE candidates in SDP
          const sdp = (signal as any).sdp || '';
          const candidateCount = (sdp.match(/a=candidate:/g) || []).length;
          console.log(`🔵 SENDER SDP contains ${candidateCount} ICE candidates`);
          dlog('sender signal', signalType, 'SDP length:', JSON.stringify(signal).length, 'candidates:', candidateCount);

          // With trickle: false, we only get one signal event with the complete offer (including ICE candidates)
          if (!offerSent && (signal as any).type === 'offer') {
            console.log('📤 SENDER: Sending offer with embedded ICE candidates');
            dlog('sender sending offer');
            const r = await fetch(`/api/p2p/${data.code}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                senderOffer: JSON.stringify(signal),
                senderConnected: true,
              }),
            });
            console.log('📤 SENDER: Offer sent, status:', r.status);
            dlog('PATCH senderOffer status', r.status);
            if (!r.ok) {
              const errorData = await r.json();
              console.error('❌ SENDER: Failed to send offer:', errorData);
            }
            offerSent = true;
          }
        } catch (err) {
          console.error('❌ SENDER: Signal error:', err);
        }
      });

      peer.on('connect', () => {
        dlog('sender connect');
        setStatus('Connected! Sending file...');
        // Stop polling once connected
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
        sendFileInChunks(peer, selectedFile);
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        setError('Connection error: ' + err.message);
        cleanup();
      });

      // Poll for receiver's answer and ICE candidates
      startPollingForAnswer(data.code, peer);

      notifications.show({
        title: 'Session Created',
        message: `Share code ${data.code} with the receiver`,
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

  const startPollingForAnswer = (sessionCode: string, peer: SimplePeer.Instance) => {
    let answerReceived = false;
    let lastCandidateCount = 0;
    let tick = 0;
    const MAX_POLL_TICKS = 60; // 60 seconds timeout

    console.log('🔵 SENDER: Starting to poll for answer (with embedded ICE candidates)');

    pollingIntervalRef.current = setInterval(async () => {
      tick += 1;

      // Timeout after MAX_POLL_TICKS
      if (tick > MAX_POLL_TICKS) {
        console.error('❌ SENDER TIMEOUT: No connection after 60 seconds');
        dlog('poll(answer) timeout after', tick, 'seconds');
        clearInterval(pollingIntervalRef.current!);
        pollingIntervalRef.current = null;
        setError('Connection timeout - receiver did not respond');
        cleanup();
        return;
      }

      try {
        const res = await fetch(`/api/p2p/${sessionCode}`);
        dlog('poll(answer) tick', tick, 'status', res.status);
        if (!res.ok) {
          clearInterval(pollingIntervalRef.current!);
          pollingIntervalRef.current = null;
          return;
        }

        const data = await res.json();
        const senderIceCount = (data.senderIceCandidates || []).length;
        const receiverIceCount = (data.receiverIceCandidates || []).length;

        if (tick % 5 === 0 || receiverIceCount > lastCandidateCount) {
          console.log(`📊 SENDER POLL #${tick}: answer=${!!data.receiverAnswer}, senderICE=${senderIceCount}, receiverICE=${receiverIceCount}, answerApplied=${answerReceived}`);
        }

        dlog('poll(answer) state', {
          hasAnswer: !!data.receiverAnswer,
          recvIceCount: receiverIceCount,
        });

        // Handle receiver's answer (only once) - contains embedded ICE candidates
        if (data.receiverAnswer && !answerReceived && !peer.destroyed) {
          const answer = JSON.parse(data.receiverAnswer);
          console.log('✅ SENDER: Received answer with embedded ICE candidates, applying...');
          dlog('sender applying receiverAnswer');
          peer.signal(answer);
          answerReceived = true;

          // Stop polling once answer is received - connection should establish automatically
          console.log('🔵 SENDER: Stopping poll, waiting for connection...');
          clearInterval(pollingIntervalRef.current!);
          pollingIntervalRef.current = null;
        }
      } catch (err) {
        console.error('❌ SENDER: Polling error:', err);
      }
    }, 1000);
  };

  const sendFileInChunks = (peer: SimplePeer.Instance, fileToSend: File) => {
    const chunkSize = 16384; // 16KB chunks
    const reader = new FileReader();
    let offset = 0;

    reader.onload = (e) => {
      if (e.target?.result && peer && !peer.destroyed) {
        peer.send(e.target.result as ArrayBuffer);
        offset += chunkSize;
        const percent = Math.min(100, (offset / fileToSend.size) * 100);
        setProgress(percent);

        if (offset < fileToSend.size) {
          readSlice(offset);
        } else {
          setStatus('File sent successfully!');
          setProgress(100);
          setTimeout(() => {
            cleanup();
            resetToIdle();
          }, 3000);
        }
      }
    };

    const readSlice = (o: number) => {
      const slice = fileToSend.slice(o, o + chunkSize);
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
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

      if (!data.senderOffer) {
        throw new Error('Sender not ready. Please wait and try again.');
      }

      fileNameRef.current = data.fileName;
      totalSizeRef.current = data.fileSize;
      dlog('receiver got metadata', { fileName: data.fileName, size: data.fileSize, hasOffer: !!data.senderOffer });
      setMode('receiving');
      setStatus('Establishing connection...');

      // Initialize WebRTC peer as receiver
      // NOTE: We use trickle: false because SimplePeer v9 doesn't properly emit ICE candidates
      // with trickle: true for data-only connections. With trickle: false, all ICE candidates
      // are embedded in the offer/answer SDP, which is more reliable.
      const peer = new SimplePeer({
        initiator: false,
        trickle: false,  // Changed from true - see note above
        config: rtcConfig
      });
      peerRef.current = peer;
      // ICE state diagnostics
      try {
        (peer as any).on?.('iceStateChange', (s: string) => dlog('receiver iceStateChange', s));
        const pc = (peer as any)._pc as RTCPeerConnection | undefined;
        if (pc) {
          pc.addEventListener('iceconnectionstatechange', () => {
            console.log('🟢 RECEIVER iceConnectionState:', pc.iceConnectionState);
            dlog('receiver iceConnectionState', pc.iceConnectionState);
          });
          pc.addEventListener('icegatheringstatechange', () => {
            console.log('🟢 RECEIVER iceGatheringState:', pc.iceGatheringState);
            dlog('receiver iceGatheringState', pc.iceGatheringState);
          });
          pc.addEventListener('connectionstatechange', () => {
            console.log('🟢 RECEIVER connectionState:', pc.connectionState);
            dlog('receiver connectionState', pc.connectionState);

            // Handle connection failures
            if (pc.connectionState === 'failed') {
              console.error('❌ RECEIVER: Connection failed');
              setError('Connection failed - please try again');
              cleanup();
            }
          });
          pc.addEventListener('icecandidateerror', (e: any) => {
            console.error('❌ RECEIVER icecandidateerror:', e?.url, e?.errorCode, e?.errorText);
            dlog('receiver icecandidateerror', e?.url, e?.errorCode, e?.errorText);
          });

          // Monitor ICE candidates for debugging (with trickle: false, these are embedded in SDP)
          let receiverIceCandidateCount = 0;
          pc.addEventListener('icecandidate', (e: RTCPeerConnectionIceEvent) => {
            if (e.candidate) {
              receiverIceCandidateCount++;
              console.log(`🧊 RECEIVER ICE candidate #${receiverIceCandidateCount}:`, e.candidate.candidate);
              dlog('receiver icecandidate #', receiverIceCandidateCount, e.candidate.candidate);
            } else {
              console.log(`✅ RECEIVER ICE gathering complete (${receiverIceCandidateCount} candidates)`);
              dlog('receiver ICE gathering complete, total candidates:', receiverIceCandidateCount);
            }
          });
        }
      } catch (e) {
        console.error('Failed to setup ICE monitoring:', e);
      }


      let answerSent = false;

      peer.on('signal', async (signal) => {
        try {
          const signalType = (signal as any).type;
          console.log('🟢 RECEIVER signal event:', signalType);

          // Count ICE candidates in SDP
          const sdp = (signal as any).sdp || '';
          const candidateCount = (sdp.match(/a=candidate:/g) || []).length;
          console.log(`🟢 RECEIVER SDP contains ${candidateCount} ICE candidates`);
          dlog('receiver signal', signalType, 'SDP length:', JSON.stringify(signal).length, 'candidates:', candidateCount);

          // With trickle: false, we only get one signal event with the complete answer (including ICE candidates)
          if (!answerSent && (signal as any).type === 'answer') {
            console.log('📤 RECEIVER: Sending answer with embedded ICE candidates');
            dlog('receiver sending answer');
            const r = await fetch(`/api/p2p/${codeToUse}`, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                receiverAnswer: JSON.stringify(signal),
                receiverConnected: true,
              }),
            });
            console.log('📤 RECEIVER: Answer sent, status:', r.status);
            dlog('PATCH receiverAnswer status', r.status);
            if (!r.ok) {
              const errorData = await r.json();
              console.error('❌ RECEIVER: Failed to send answer:', errorData);
            }
            answerSent = true;
          }
        } catch (err) {
          console.error('❌ RECEIVER: Signal error:', err);
        }
      });

      peer.on('connect', () => {
        dlog('receiver connect');
        setStatus('Connected! Receiving file...');
        // Stop polling once connected
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      });

      peer.on('data', (chunk: Uint8Array) => {
        chunksRef.current.push(chunk);
        receivedSizeRef.current += chunk.length;
        const percent = (receivedSizeRef.current / totalSizeRef.current) * 100;
        setProgress(percent);

        if (receivedSizeRef.current >= totalSizeRef.current) {
          completeFileReceive();
        }
      });

      peer.on('error', (err) => {
        console.error('Peer error:', err);
        setError('Connection error: ' + err.message);
        cleanup();
      });

      // Signal with sender's offer (contains embedded ICE candidates with trickle: false)
      if (data.senderOffer) {
        const offer = JSON.parse(data.senderOffer);
        console.log('🟢 RECEIVER: Applying offer with embedded ICE candidates');
        dlog('receiver applying offer');
        peer.signal(offer);
        console.log('🟢 RECEIVER: Offer applied, answer will be generated automatically');
      } else {
        throw new Error('No offer found in session');
      }

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



  const completeFileReceive = () => {
    const blob = new Blob(chunksRef.current);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileNameRef.current;
    a.click();
    URL.revokeObjectURL(url);

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
  };

  const copyCode = () => {
    navigator.clipboard.writeText(code);
    notifications.show({
      title: 'Copied',
      message: 'Code copied to clipboard',
      color: 'blue',
      icon: <IconCopy size={16} />,
    });
  };

  return (
    <Stack gap="lg">
      {mode === 'idle' && (
        <>
          <Card withBorder radius="lg" p="xl" shadow="md" className="bg-white border-gray-200">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Box>
                  <Title order={3} className="text-xl font-bold">
                    Send a File
                  </Title>
                  <Text size="sm" c="dimmed" mt="xs">
                    Share files directly with anyone using a 6-digit code
                  </Text>
                </Box>
                <IconUpload size={32} className="text-blue-500" />
              </Group>

              <Divider />

              <FileButton onChange={handleSendFile} accept="*">
                {(props) => (
                  <Button
                    {...props}
                    size="lg"
                    leftSection={<IconUpload size={18} />}
                    loading={loading}
                    fullWidth
                    color="blue"
                  >
                    Select File to Send
                  </Button>
                )}
              </FileButton>

              <Text size="xs" c="dimmed" ta="center">
                Files are transferred directly between devices (P2P). No server storage.
              </Text>
            </Stack>
          </Card>

          <Card withBorder radius="lg" p="xl" shadow="md" className="bg-white border-gray-200">
            <Stack gap="md">
              <Group justify="space-between" align="center">
                <Box>
                  <Title order={3} className="text-xl font-bold">
                    Receive a File
                  </Title>
                  <Text size="sm" c="dimmed" mt="xs">
                    Enter the 6-digit code to download a file
                  </Text>
                </Box>
                <IconDownload size={32} className="text-green-500" />
              </Group>

              <Divider />

              <Box>
                <Text size="sm" fw={500} mb="sm" ta="center">
                  Enter the 6-digit code
                </Text>
                <CodeInput
                  value={inputCode}
                  onChange={setInputCode}
                  onComplete={handleReceiveFile}
                  disabled={loading}
                />
              </Box>

              <Button
                size="lg"
                leftSection={<IconDownload size={18} />}
                onClick={() => handleReceiveFile()}
                loading={loading}
                disabled={inputCode.length !== 6}
                fullWidth
                color="green"
              >
                Receive File
              </Button>

              <Text size="xs" c="dimmed" ta="center">
                The file will download automatically when all digits are entered
              </Text>
            </Stack>
          </Card>
        </>
      )}

      {mode === 'sending' && (
        <Card withBorder radius="lg" p="xl" shadow="md" className="bg-white border-gray-200">
          <Stack gap="lg">
            <Group justify="space-between">
              <Title order={3}>Sending File</Title>
              <Button
                variant="subtle"
                color="red"
                leftSection={<IconX size={16} />}
                onClick={() => {
                  cleanup();
                  resetToIdle();
                }}
              >
                Cancel
              </Button>
            </Group>

            <Alert color="blue" title="Share this code" icon={<IconCopy size={18} />}>
              <Group justify="space-between" align="center">
                <Text size="xl" fw={700} className="font-mono tracking-wider">
                  {code}
                </Text>
                <Button size="xs" variant="light" onClick={copyCode}>
                  Copy
                </Button>
              </Group>
            </Alert>

            <Box>
              <Text size="sm" c="dimmed" mb="xs">
                File: {file?.name}
              </Text>
              <Text size="sm" c="dimmed" mb="md">
                Status: {status}
              </Text>
              <Progress value={progress} size="lg" radius="xl" animated />
              <Text size="xs" c="dimmed" mt="xs" ta="right">
                {Math.round(progress)}%
              </Text>
            </Box>
          </Stack>
        </Card>
      )}

      {mode === 'receiving' && (
        <Card withBorder radius="lg" p="xl" shadow="md" className="bg-white border-gray-200">
          <Stack gap="lg">
            <Group justify="space-between">
              <Title order={3}>Receiving File</Title>
              <Button
                variant="subtle"
                color="red"
                leftSection={<IconX size={16} />}
                onClick={() => {
                  cleanup();
                  resetToIdle();
                }}
              >
                Cancel
              </Button>
            </Group>

            <Box>
              <Text size="sm" c="dimmed" mb="xs">
                File: {fileNameRef.current}
              </Text>
              <Text size="sm" c="dimmed" mb="md">
                Status: {status}
              </Text>
              <Progress value={progress} size="lg" radius="xl" animated color="green" />
              <Text size="xs" c="dimmed" mt="xs" ta="right">
                {Math.round(progress)}%
              </Text>
            </Box>
          </Stack>
        </Card>
      )}

      {error && (
        <Alert color="red" title="Error" icon={<IconAlertCircle size={18} />} onClose={() => setError(null)} withCloseButton>
          {error}
        </Alert>
      )}
    </Stack>
  );
}

