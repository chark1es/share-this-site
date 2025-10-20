import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue, Timestamp } from "../../../lib/server/firebase-admin";

// Generate a random 6-digit code
function generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(ctx: APIContext): Promise<Response> {
    try {
        const body = await ctx.request.json();
        const { fileName, fileSize, fileType } = body;
        console.log("[P2P][create] Request", { fileName, fileSize, fileType });

        if (!fileName || !fileSize) {
            return new Response(
                JSON.stringify({ error: "fileName and fileSize are required" }),
                { status: 400, headers: { "content-type": "application/json" } }
            );
        }

        // Generate unique 6-digit code
        let code = "";
        let attempts = 0;
        while (attempts++ < 50) {
            code = generateCode();
            const ref = db.collection("p2p-sessions").doc(code);
            const snap = await ref.get();

            if (!snap.exists) {
                // Create new session
                const expireAt = Timestamp.fromDate(
                    new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
                );

                await ref.set({
                    fileName,
                    fileSize,
                    fileType: fileType || "application/octet-stream",
                    createdAt: FieldValue.serverTimestamp(),
                    expireAt,
                    active: true,
                    senderConnected: true,
                    receiverConnected: false,
                    senderOffer: null,
                    receiverAnswer: null,
                    senderIceCandidates: [],
                    receiverIceCandidates: [],
                });

                console.log(
                    "[P2P][create] Created session",
                    code,
                    "expireAt",
                    expireAt.toDate().toISOString()
                );
                return new Response(
                    JSON.stringify({
                        code,
                        expireAt: expireAt.toDate().toISOString(),
                    }),
                    {
                        status: 201,
                        headers: { "content-type": "application/json" },
                    }
                );
            }

            // Check if existing session is expired
            const data = snap.data() as any;
            const isExpired =
                !data?.expireAt || data.expireAt.toMillis() <= Date.now();

            if (isExpired || data?.active === false) {
                // Reuse expired code
                const expireAt = Timestamp.fromDate(
                    new Date(Date.now() + 30 * 60 * 1000)
                );

                await ref.set({
                    fileName,
                    fileSize,
                    fileType: fileType || "application/octet-stream",
                    createdAt: FieldValue.serverTimestamp(),
                    expireAt,
                    active: true,
                    senderConnected: true,
                    receiverConnected: false,
                    senderOffer: null,
                    receiverAnswer: null,
                    senderIceCandidates: [],
                    receiverIceCandidates: [],
                });

                console.log(
                    "[P2P][create] Reused code, new session",
                    code,
                    "expireAt",
                    expireAt.toDate().toISOString()
                );
                return new Response(
                    JSON.stringify({
                        code,
                        expireAt: expireAt.toDate().toISOString(),
                    }),
                    {
                        status: 201,
                        headers: { "content-type": "application/json" },
                    }
                );
            }
        }

        return new Response(
            JSON.stringify({ error: "Failed to generate unique code" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    } catch (err: any) {
        console.error("P2P create error:", err);
        return new Response(
            JSON.stringify({ error: err?.message || "Internal server error" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    }
}
