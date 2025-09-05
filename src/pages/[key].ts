import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue } from "../lib/server/firebase-admin";

export async function GET({ params }: APIContext): Promise<Response> {
    const key = params.key as string;
    const ref = db.collection("links").doc(key);
    const snap = await ref.get();

    if (!snap.exists) {
        return new Response("Not Found", { status: 404 });
    }

    const data = snap.data() as any;
    const expired = !data?.expireAt || data.expireAt.toMillis() <= Date.now();

    if (expired || data?.active === false) {
        // Optional GC: remove expired/inactive link
        ref.delete().catch(() => {});
        return new Response("Not Found", { status: 404 });
    }

    // Increment visits asynchronously
    ref.update({ visits: FieldValue.increment(1) }).catch(() => {});

    return new Response(null, {
        status: 302,
        headers: { Location: String(data.url) },
    });
}
