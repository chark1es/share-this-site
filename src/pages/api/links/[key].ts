import type { APIContext } from "astro";
export const prerender = false;

import { db } from "../../../lib/server/firebase-admin";

export async function GET({ params }: APIContext): Promise<Response> {
    const key = params.key as string;
    const snap = await db.collection("links").doc(key).get();
    if (!snap.exists)
        return new Response(JSON.stringify({ error: "Not found" }), {
            status: 404,
            headers: { "content-type": "application/json" },
        });
    const data = snap.data() as any;
    const payload = {
        ...data,
        expireAt: data?.expireAt?.toDate?.()?.toISOString?.(),
        key,
    };
    return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
    });
}

export async function DELETE({ params }: APIContext): Promise<Response> {
    const key = params.key as string;
    await db.collection("links").doc(key).delete();
    return new Response(null, { status: 204 });
}
