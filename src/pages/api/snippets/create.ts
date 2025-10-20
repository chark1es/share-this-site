import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue, Timestamp } from "../../../lib/server/firebase-admin";
import { pickWord } from "../../../lib/words";

export async function POST(ctx: APIContext): Promise<Response> {
    try {
        const body = await ctx.request.json();
        const { content, language, title, ttlMinutes } = body;

        if (!content || content.trim().length === 0) {
            return new Response(
                JSON.stringify({ error: "Content is required" }),
                { status: 400, headers: { "content-type": "application/json" } }
            );
        }

        const ttl = Math.max(
            1,
            Math.min(10080, isFinite(ttlMinutes) ? ttlMinutes : 1440)
        ); // Default 24 hours

        const expireAt = Timestamp.fromDate(
            new Date(Date.now() + ttl * 60 * 1000)
        );

        let key = "";
        let attempts = 0;
        while (attempts++ < 50) {
            key = await pickWord();
            const ref = db.collection("snippets").doc(key);
            const snap = await ref.get();

            if (!snap.exists) {
                await ref.set({
                    content: content.trim(),
                    language: language || "plaintext",
                    title: title || "Untitled",
                    createdAt: FieldValue.serverTimestamp(),
                    expireAt,
                    views: 0,
                    active: true,
                });

                const origin = (
                    (import.meta as any).env?.SITE_URL ??
                    process.env.SITE_URL ??
                    new URL(ctx.request.url).origin
                )?.replace(/\/$/, "");

                return new Response(
                    JSON.stringify({
                        key,
                        url: `${origin}/snippet/${key}`,
                        expireAt: expireAt.toDate().toISOString(),
                    }),
                    {
                        status: 201,
                        headers: { "content-type": "application/json" },
                    }
                );
            }

            // Check if existing snippet is expired
            const data = snap.data() as any;
            const isExpired =
                !data?.expireAt || data.expireAt.toMillis() <= Date.now();

            if (isExpired || data?.active === false) {
                await ref.set({
                    content: content.trim(),
                    language: language || "plaintext",
                    title: title || "Untitled",
                    createdAt: FieldValue.serverTimestamp(),
                    expireAt,
                    views: 0,
                    active: true,
                });

                const origin = (
                    (import.meta as any).env?.SITE_URL ??
                    process.env.SITE_URL ??
                    new URL(ctx.request.url).origin
                )?.replace(/\/$/, "");

                return new Response(
                    JSON.stringify({
                        key,
                        url: `${origin}/snippet/${key}`,
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
            JSON.stringify({ error: "Failed to generate unique key" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    } catch (err: any) {
        console.error("Snippet create error:", err);
        return new Response(
            JSON.stringify({ error: err?.message || "Internal server error" }),
            { status: 500, headers: { "content-type": "application/json" } }
        );
    }
}

