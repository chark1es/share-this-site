import type { APIContext } from "astro";
export const prerender = false;

import { db, FieldValue } from "../../lib/server/firebase-admin";

export async function GET({ params, redirect }: APIContext): Promise<Response> {
    const key = params.key as string;
    const ref = db.collection("links").doc(key);
    const snap = await ref.get();

    if (!snap.exists) {
        return redirect("/expired", 302);
    }

    const data = snap.data() as any;
    const expired = !data?.expireAt || data.expireAt.toMillis() <= Date.now();

    if (expired || data?.active === false) {
        return redirect("/expired", 302);
    }

    // Increment visits asynchronously
    ref.update({ visits: FieldValue.increment(1) }).catch(() => {});

    return new Response(null, {
        status: 302,
        headers: { Location: String(data.url) },
    });
}
