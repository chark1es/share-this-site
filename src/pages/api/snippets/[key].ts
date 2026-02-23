import type { APIContext } from "astro";
export const prerender = false;

import { convex } from "../../../lib/server/convex";

export async function GET({ params }: APIContext): Promise<Response> {
    try {
        const key = params.key as string;
        const snippet = await convex.query("snippets:getSnippet", { key });

        if (!snippet) {
            return new Response(
                JSON.stringify({ error: "Snippet not found" }),
                { status: 404, headers: { "content-type": "application/json" } }
            );
        }

        const expired = !snippet?.expireAt || snippet.expireAt <= Date.now();

        if (expired || snippet?.active === false) {
            convex.mutation("snippets:deleteSnippet", { key }).catch(() => {});
            return new Response(
                JSON.stringify({ error: "Snippet expired" }),
                { status: 410, headers: { "content-type": "application/json" } }
            );
        }

        convex.mutation("snippets:incrementViews", { key }).catch(() => {});

        return new Response(
            JSON.stringify({
                key,
                content: snippet.content,
                language: snippet.language,
                title: snippet.title,
                createdAt: new Date(snippet.createdAt).toISOString(),
                expireAt: new Date(snippet.expireAt).toISOString(),
                views: snippet.views,
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

