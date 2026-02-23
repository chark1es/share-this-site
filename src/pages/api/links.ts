import type { APIContext } from "astro";
export const prerender = false;

import { convex } from "../../lib/server/convex";
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

        const now = Date.now();
        const expireAt = now + ttl * 60 * 1000;

        let key = "";
        let attempts = 0;
        while (attempts++ < 50) {
            key = await pickWord();

            const existing = await convex.query("links:getLink", { key });

            if (!existing) {
                await convex.mutation("links:createLink", {
                    key,
                    url: targetUrl,
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
                        url: targetUrl,
                        shortUrl: `${origin}/${key}`,
                        expireAt: new Date(expireAt).toISOString(),
                    }),
                    {
                        status: 201,
                        headers: { "content-type": "application/json" },
                    }
                );
            }

            const isExpired = !existing?.expireAt || existing.expireAt <= Date.now();
            const isInactive = existing?.active === false;

            if (isExpired || isInactive) {
                await convex.mutation("links:updateLink", {
                    key,
                    url: targetUrl,
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
                        url: targetUrl,
                        shortUrl: `${origin}/${key}`,
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
