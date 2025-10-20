import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const port = process.env.PORT || 8080;

// Import Astro handler dynamically after build
let ssrHandler: any;
try {
    const astroModule = await import("../dist/server/entry.mjs");
    ssrHandler = astroModule.handler;
    console.log("✅ Astro SSR handler loaded");
} catch (err) {
    console.error("❌ Failed to load Astro SSR handler:", err);
    process.exit(1);
}

// Use Astro's SSR handler
app.use(ssrHandler);

// Create HTTP server
const server = createServer(app);

// Setup WebSocket server inline
const rooms = new Map<
    string,
    Array<{ ws: any; role: "sender" | "receiver" }>
>();

const wss = new WebSocketServer({
    server,
    path: "/ws/signaling",
});

console.log("📡 WebSocket signaling server initialized at /ws/signaling");

wss.on("connection", (ws) => {
    console.log("[WebSocket] New connection");
    let currentClient: {
        roomCode: string;
        role: "sender" | "receiver";
    } | null = null;

    ws.on("message", (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log(
                "[WebSocket] Received message:",
                message.type,
                message.roomCode
            );

            switch (message.type) {
                case "join": {
                    const { roomCode, role } = message;

                    if (!rooms.has(roomCode)) {
                        rooms.set(roomCode, []);
                    }

                    const room = rooms.get(roomCode)!;

                    // Check if room is full
                    if (room.length >= 2) {
                        ws.send(
                            JSON.stringify({
                                type: "error",
                                message: "Room is full",
                            })
                        );
                        return;
                    }

                    // Check if role already exists
                    if (room.some((client) => client.role === role)) {
                        ws.send(
                            JSON.stringify({
                                type: "error",
                                message: `${role} already exists in this room`,
                            })
                        );
                        return;
                    }

                    currentClient = { roomCode, role };
                    room.push({ ws, role });

                    console.log(
                        `[WebSocket] ${role} joined room ${roomCode} (${room.length}/2)`
                    );
                    ws.send(JSON.stringify({ type: "joined", roomCode, role }));

                    // Notify the other peer if they're already in the room
                    const otherPeer = room.find(
                        (client) => client.role !== role
                    );
                    if (otherPeer) {
                        console.log(
                            `[WebSocket] Notifying ${role} that ${otherPeer.role} joined`
                        );
                        ws.send(
                            JSON.stringify({
                                type: "peer-joined",
                                role: otherPeer.role,
                            })
                        );
                        otherPeer.ws.send(
                            JSON.stringify({ type: "peer-joined", role })
                        );
                    }
                    break;
                }

                case "offer":
                case "answer":
                case "ice-candidate": {
                    if (!currentClient) {
                        ws.send(
                            JSON.stringify({
                                type: "error",
                                message: "Not in a room",
                            })
                        );
                        return;
                    }

                    const room = rooms.get(currentClient.roomCode);
                    if (!room) {
                        ws.send(
                            JSON.stringify({
                                type: "error",
                                message: "Room not found",
                            })
                        );
                        return;
                    }

                    // Forward message to the other peer
                    const otherPeer = room.find(
                        (client) => client.role !== currentClient!.role
                    );
                    if (otherPeer) {
                        console.log(
                            `[WebSocket] Forwarding ${message.type} from ${currentClient.role} to ${otherPeer.role} in room ${currentClient.roomCode}`
                        );
                        otherPeer.ws.send(JSON.stringify(message));
                    }
                    break;
                }

                case "leave": {
                    if (currentClient) {
                        const room = rooms.get(currentClient.roomCode);
                        if (room) {
                            const index = room.findIndex(
                                (client) => client.ws === ws
                            );
                            if (index !== -1) {
                                room.splice(index, 1);
                                console.log(
                                    `[WebSocket] ${currentClient.role} left room ${currentClient.roomCode}`
                                );

                                // Notify other peer
                                const otherPeer = room[0];
                                if (otherPeer) {
                                    otherPeer.ws.send(
                                        JSON.stringify({ type: "peer-left" })
                                    );
                                }

                                // Clean up empty rooms
                                if (room.length === 0) {
                                    rooms.delete(currentClient.roomCode);
                                }
                            }
                        }
                        currentClient = null;
                    }
                    break;
                }
            }
        } catch (err) {
            console.error("[WebSocket] Error processing message:", err);
            ws.send(
                JSON.stringify({
                    type: "error",
                    message: "Invalid message format",
                })
            );
        }
    });

    ws.on("close", () => {
        console.log("[WebSocket] Connection closed");
        if (currentClient) {
            const room = rooms.get(currentClient.roomCode);
            if (room) {
                const index = room.findIndex((client) => client.ws === ws);
                if (index !== -1) {
                    room.splice(index, 1);
                    console.log(
                        `[WebSocket] ${currentClient.role} disconnected from room ${currentClient.roomCode}`
                    );

                    // Notify other peer
                    const otherPeer = room[0];
                    if (otherPeer) {
                        otherPeer.ws.send(
                            JSON.stringify({ type: "peer-left" })
                        );
                    }

                    // Clean up empty rooms
                    if (room.length === 0) {
                        rooms.delete(currentClient.roomCode);
                    }
                }
            }
        }
    });

    ws.on("error", (err) => {
        console.error("[WebSocket] WebSocket error:", err);
    });
});

server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
    console.log(
        `📡 WebSocket signaling available at ws://localhost:${port}/ws/signaling`
    );
});

server.on("error", (err) => {
    console.error("❌ Server error:", err);
    process.exit(1);
});
