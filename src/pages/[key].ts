import type { APIContext } from "astro";
export const prerender = false;

import { convex } from "../lib/server/convex";

export async function GET({ params, url }: APIContext): Promise<Response> {
    const key = params.key as string;
    const link = await convex.query("links:getLink", { key });

    if (!link) {
        const origin = url.origin;
        return new Response(null, {
            status: 302,
            headers: {
                Location: `${origin}/?expired=true&key=${encodeURIComponent(key)}`,
            },
        });
    }

    const expired = !link?.expireAt || link.expireAt <= Date.now();

    if (expired || link?.active === false) {
        convex.mutation("links:deleteLink", { key }).catch(() => {});
        const origin = url.origin;
        return new Response(null, {
            status: 302,
            headers: {
                Location: `${origin}/?expired=true&key=${encodeURIComponent(key)}`,
            },
        });
    }

    convex.mutation("links:incrementVisits", { key }).catch(() => {});

    return new Response(null, {
        status: 302,
        headers: { Location: String(link.url) },
    });
}
