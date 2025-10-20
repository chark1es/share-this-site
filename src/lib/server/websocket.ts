import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface Client {
  ws: WebSocket;
  roomCode: string;
  role: 'sender' | 'receiver';
  peerId: string;
}

interface SignalingMessage {
  type: 'join' | 'offer' | 'answer' | 'ice-candidate' | 'leave' | 'peer-joined' | 'error';
  roomCode?: string;
  role?: 'sender' | 'receiver';
  peerId?: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  error?: string;
}

// Map of room codes to clients
const rooms = new Map<string, Client[]>();

export function setupWebSocketServer(server: Server) {
  const wss = new WebSocketServer({ 
    server,
    path: '/ws/signaling'
  });

  console.log('[WebSocket] Signaling server initialized at /ws/signaling');

  wss.on('connection', (ws: WebSocket) => {
    console.log('[WebSocket] New connection');
    let currentClient: Client | null = null;

    ws.on('message', (data: Buffer) => {
      try {
        const message: SignalingMessage = JSON.parse(data.toString());
        console.log('[WebSocket] Received message:', message.type, message.roomCode);

        switch (message.type) {
          case 'join':
            handleJoin(ws, message);
            break;
          case 'offer':
            handleOffer(message);
            break;
          case 'answer':
            handleAnswer(message);
            break;
          case 'ice-candidate':
            handleIceCandidate(message);
            break;
          case 'leave':
            handleLeave(currentClient);
            break;
        }
      } catch (error) {
        console.error('[WebSocket] Error processing message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid message format'
        }));
      }
    });

    ws.on('close', () => {
      console.log('[WebSocket] Connection closed');
      handleLeave(currentClient);
    });

    ws.on('error', (error) => {
      console.error('[WebSocket] Connection error:', error);
      handleLeave(currentClient);
    });

    function handleJoin(ws: WebSocket, message: SignalingMessage) {
      const { roomCode, role, peerId } = message;
      
      if (!roomCode || !role || !peerId) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Missing roomCode, role, or peerId'
        }));
        return;
      }

      // Create client
      currentClient = { ws, roomCode, role, peerId };

      // Get or create room
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, []);
      }
      const room = rooms.get(roomCode)!;

      // Check if room is full (max 2 clients: sender + receiver)
      if (room.length >= 2) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Room is full'
        }));
        return;
      }

      // Check if role already exists in room
      const existingRole = room.find(c => c.role === role);
      if (existingRole) {
        ws.send(JSON.stringify({
          type: 'error',
          error: `${role} already exists in this room`
        }));
        return;
      }

      // Add client to room
      room.push(currentClient);
      console.log(`[WebSocket] ${role} joined room ${roomCode} (${room.length}/2)`);

      // Confirm join
      ws.send(JSON.stringify({
        type: 'joined',
        roomCode,
        role
      }));

      // Notify other peer if they exist
      const otherPeer = room.find(c => c.peerId !== peerId);
      if (otherPeer) {
        console.log(`[WebSocket] Notifying ${otherPeer.role} that ${role} joined`);
        otherPeer.ws.send(JSON.stringify({
          type: 'peer-joined',
          role,
          peerId
        }));

        // Also notify the new peer about the existing peer
        ws.send(JSON.stringify({
          type: 'peer-joined',
          role: otherPeer.role,
          peerId: otherPeer.peerId
        }));
      }
    }

    function handleOffer(message: SignalingMessage) {
      const { roomCode, sdp } = message;
      if (!roomCode || !sdp) return;

      const room = rooms.get(roomCode);
      if (!room) return;

      // Forward offer to receiver
      const receiver = room.find(c => c.role === 'receiver');
      if (receiver) {
        console.log(`[WebSocket] Forwarding offer to receiver in room ${roomCode}`);
        receiver.ws.send(JSON.stringify({
          type: 'offer',
          sdp
        }));
      }
    }

    function handleAnswer(message: SignalingMessage) {
      const { roomCode, sdp } = message;
      if (!roomCode || !sdp) return;

      const room = rooms.get(roomCode);
      if (!room) return;

      // Forward answer to sender
      const sender = room.find(c => c.role === 'sender');
      if (sender) {
        console.log(`[WebSocket] Forwarding answer to sender in room ${roomCode}`);
        sender.ws.send(JSON.stringify({
          type: 'answer',
          sdp
        }));
      }
    }

    function handleIceCandidate(message: SignalingMessage) {
      const { roomCode, candidate, role } = message;
      if (!roomCode || !candidate) return;

      const room = rooms.get(roomCode);
      if (!room) return;

      // Forward ICE candidate to the other peer
      const targetRole = role === 'sender' ? 'receiver' : 'sender';
      const targetPeer = room.find(c => c.role === targetRole);
      
      if (targetPeer) {
        console.log(`[WebSocket] Forwarding ICE candidate from ${role} to ${targetRole} in room ${roomCode}`);
        targetPeer.ws.send(JSON.stringify({
          type: 'ice-candidate',
          candidate
        }));
      }
    }

    function handleLeave(client: Client | null) {
      if (!client) return;

      const { roomCode, role } = client;
      const room = rooms.get(roomCode);
      
      if (room) {
        // Remove client from room
        const index = room.findIndex(c => c.peerId === client.peerId);
        if (index !== -1) {
          room.splice(index, 1);
          console.log(`[WebSocket] ${role} left room ${roomCode} (${room.length}/2)`);
        }

        // Notify other peer
        const otherPeer = room.find(c => c.peerId !== client.peerId);
        if (otherPeer) {
          otherPeer.ws.send(JSON.stringify({
            type: 'peer-left',
            role
          }));
        }

        // Clean up empty rooms
        if (room.length === 0) {
          rooms.delete(roomCode);
          console.log(`[WebSocket] Room ${roomCode} deleted (empty)`);
        }
      }

      currentClient = null;
    }
  });

  return wss;
}

