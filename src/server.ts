import { handler as ssrHandler } from '../dist/server/entry.mjs';
import express from 'express';
import { createServer } from 'http';
import { setupWebSocketServer } from './lib/server/websocket.js';

const app = express();
const port = process.env.PORT || 8080;

// Use Astro's SSR handler
app.use(ssrHandler);

// Create HTTP server
const server = createServer(app);

// Setup WebSocket server
setupWebSocketServer(server);

server.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📡 WebSocket signaling available at ws://localhost:${port}/ws/signaling`);
});

