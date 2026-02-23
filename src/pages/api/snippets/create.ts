import type { APIContext } from "astro";
export const prerender = false;

import { convex } from "../../../lib/server/convex";
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
        );

        const now = Date.now();
        const expireAt = now + ttl * 60 * 1000;

        let key = "";
        let attempts = 0;
        while (attempts++ < 50) {
            key = await pickWord();

            const existing = await convex.query("snippets:getSnippet", { key });

            if (!existing) {
                await convex.mutation("snippets:createSnippet", {
                    key,
                    content: content.trim(),
                    language: language || "plaintext",
                    title: title || "Untitled",
                    createdAt: now,
                    expireAt,
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
                        expireAt: new Date(expireAt).toISOString(),
                    }),
                    {
                        status: 201,
                        headers: { "content-type": "application/json" },
                    }
                );
            }

            const isExpired = !existing?.expireAt || existing.expireAt <= Date.now();

            if (isExpired || existing?.active === false) {
                await convex.mutation("snippets:updateSnippet", {
                    key,
                    content: content.trim(),
                    language: language || "plaintext",
                    title: title || "Untitled",
                    createdAt: now,
                    expireAt,
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
                        expireAt: new Date(expireAt).toISOString(),
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

