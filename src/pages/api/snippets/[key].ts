import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue } from "../../../lib/server/firebase-admin";

export async function GET({ params }: APIContext): Promise<Response> {
    try {
        const key = params.key as string;
        const ref = db.collection("snippets").doc(key);
        const snap = await ref.get();

        if (!snap.exists) {
            return new Response(
                JSON.stringify({ error: "Snippet not found" }),
                { status: 404, headers: { "content-type": "application/json" } }
            );
        }

        const data = snap.data() as any;
        const expired = !data?.expireAt || data.expireAt.toMillis() <= Date.now();

        if (expired || data?.active === false) {
            // Clean up expired snippet
            ref.delete().catch(() => {});
            return new Response(
                JSON.stringify({ error: "Snippet expired" }),
                { status: 410, headers: { "content-type": "application/json" } }
            );
        }

        // Increment views asynchronously
        ref.update({ views: FieldValue.increment(1) }).catch(() => {});

        return new Response(
            JSON.stringify({
                key,
                content: data.content,
                language: data.language,
                title: data.title,
                createdAt: data.createdAt?.toDate().toISOString(),
                expireAt: data.expireAt?.toDate().toISOString(),
                views: data.views,
            }),
            { status: 200, headers: { "content-type": "application/json" } }
        );
    } catch (err: any) {
        console.error("Snippet get error:", err);
        return new Response(
            JSON.stringify({ error: err?.message || "Internal server error" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    }
}

