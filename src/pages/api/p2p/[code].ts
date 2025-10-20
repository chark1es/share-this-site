import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue } from "../../../lib/server/firebase-admin";

export async function GET({ params }: APIContext): Promise<Response> {
    try {
        const code = params.code as string;
        const ref = db.collection("p2p-sessions").doc(code);
        const snap = await ref.get();
        console.log("[P2P][GET]", code, "exists", snap.exists);

        if (!snap.exists) {
            return new Response(
                JSON.stringify({ error: "Session not found" }),
                { status: 404, headers: { "content-type": "application/json" } }
            );
        }

        const data = snap.data() as any;
        const expired =
            !data?.expireAt || data.expireAt.toMillis() <= Date.now();
        console.log("[P2P][GET] expired?", expired);

        if (expired || data?.active === false) {
            // Clean up expired session
            ref.delete().catch(() => {});
            return new Response(JSON.stringify({ error: "Session expired" }), {
                status: 410,
                headers: { "content-type": "application/json" },
            });
        }

        console.log("[P2P][GET] returning", code, {
            senderIceCount: (data.senderIceCandidates || []).length,
            receiverIceCount: (data.receiverIceCandidates || []).length,
            hasOffer: !!data.senderOffer,
            hasAnswer: !!data.receiverAnswer,
        });
        return new Response(
            JSON.stringify({
                code,
                fileName: data.fileName,
                fileSize: data.fileSize,
                fileType: data.fileType,
                senderConnected: data.senderConnected,
                receiverConnected: data.receiverConnected,
                senderOffer: data.senderOffer,
                receiverAnswer: data.receiverAnswer,
                senderIceCandidates: data.senderIceCandidates || [],
                receiverIceCandidates: data.receiverIceCandidates || [],
            }),
            { status: 200, headers: { "content-type": "application/json" } }
        );
    } catch (err: any) {
        console.error("P2P get error:", err);
        return new Response(
            JSON.stringify({ error: err?.message || "Internal server error" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    }
}

export async function PATCH({
    params,
    request,
}: APIContext): Promise<Response> {
    try {
        const code = params.code as string;
        const body = await request.json();
        const ref = db.collection("p2p-sessions").doc(code);
        const snap = await ref.get();
        console.log("[P2P][PATCH]", code, {
            hasSenderOffer: body.senderOffer !== undefined,
            hasReceiverAnswer: body.receiverAnswer !== undefined,
            hasSenderIce: body.senderIceCandidate !== undefined,
            hasReceiverIce: body.receiverIceCandidate !== undefined,
            senderConnected: body.senderConnected,
            receiverConnected: body.receiverConnected,
            active: body.active,
        });

        if (!snap.exists) {
            return new Response(
                JSON.stringify({ error: "Session not found" }),
                { status: 404, headers: { "content-type": "application/json" } }
            );
        }

        const data = snap.data() as any;
        const expired =
            !data?.expireAt || data.expireAt.toMillis() <= Date.now();

        if (expired || data?.active === false) {
            ref.delete().catch(() => {});
            return new Response(JSON.stringify({ error: "Session expired" }), {
                status: 410,
                headers: { "content-type": "application/json" },
            });
        }

        // Update session with signaling data
        const updates: any = {};

        if (body.senderOffer !== undefined) {
            updates.senderOffer = body.senderOffer;
        }
        if (body.receiverAnswer !== undefined) {
            updates.receiverAnswer = body.receiverAnswer;
        }
        if (body.senderIceCandidate !== undefined) {
            updates.senderIceCandidates = FieldValue.arrayUnion(
                body.senderIceCandidate
            );
        }
        if (body.receiverIceCandidate !== undefined) {
            updates.receiverIceCandidates = FieldValue.arrayUnion(
                body.receiverIceCandidate
            );
        }
        if (body.senderConnected !== undefined) {
            updates.senderConnected = body.senderConnected;
        }
        if (body.receiverConnected !== undefined) {
            updates.receiverConnected = body.receiverConnected;
        }
        if (body.active !== undefined) {
            updates.active = body.active;
        }

        console.log("[P2P][PATCH] updates keys", Object.keys(updates));
        await ref.update(updates);
        const after = await ref.get();
        const ad = after.data() as any;
        console.log("[P2P][PATCH] post-update", code, {
            senderIceCount: (ad?.senderIceCandidates || []).length,
            receiverIceCount: (ad?.receiverIceCandidates || []).length,
            hasOffer: !!ad?.senderOffer,
            hasAnswer: !!ad?.receiverAnswer,
        });

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    } catch (err: any) {
        console.error("P2P update error:", err);
        return new Response(
            JSON.stringify({ error: err?.message || "Internal server error" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    }
}

export async function DELETE({ params }: APIContext): Promise<Response> {
    try {
        const code = params.code as string;
        const ref = db.collection("p2p-sessions").doc(code);
        await ref.delete();

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "content-type": "application/json" },
        });
    } catch (err: any) {
        console.error("P2P delete error:", err);
        return new Response(
            JSON.stringify({ error: err?.message || "Internal server error" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    }
}
