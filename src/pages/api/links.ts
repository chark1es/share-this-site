import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue, Timestamp } from "../../lib/server/firebase-admin";
import { pickWord } from "../../lib/words";

function normalizeUrl(input: string): string {
    const raw = input?.trim();
    if (!raw) throw new Error("URL is required");
    try {
        const withScheme = /^(https?:)?\/\//i.test(raw)
            ? raw
            : `https://${raw}`;
        const u = new URL(withScheme);
        return u.toString();
    } catch {
        throw new Error("Invalid URL");
    }
}

export async function POST(ctx: APIContext): Promise<Response> {
    try {
        const body = await ctx.request.json();
        const ttlMinutes = Number(body?.ttlMinutes ?? 60);
        const ttl = Math.max(
            1,
            Math.min(10080, isFinite(ttlMinutes) ? ttlMinutes : 60)
        );
        const targetUrl = normalizeUrl(String(body?.url || ""));

        const expireAt = Timestamp.fromDate(
            new Date(Date.now() + ttl * 60 * 1000)
        );

        let key = "";
        let attempts = 0;
        while (attempts++ < 50) {
            key = pickWord();
            const ref = db.collection("links").doc(key);
            const snap = await ref.get();
            if (!snap.exists) {
                await ref.set({
                    url: targetUrl,
                    createdAt: FieldValue.serverTimestamp(),
                    expireAt,
                    visits: 0,
                    active: true,
                });
                const origin =
                    process.env.SITE_URL || new URL(ctx.request.url).origin;
                return new Response(
                    JSON.stringify({
                        key,
                        url: targetUrl,
                        shortUrl: `${origin}/${key}`,
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
            JSON.stringify({
                error: "Collision: unable to allocate word. Try again.",
            }),
            {
                status: 503,
                headers: { "content-type": "application/json" },
            }
        );
    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err?.message ?? "Bad Request" }),
            {
                status: 400,
                headers: { "content-type": "application/json" },
            }
        );
    }
}
