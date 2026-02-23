import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL = (import.meta as any).env?.CONVEX_URL ?? process.env.CONVEX_URL;
const RAW_TIMEOUT_MS =
    (import.meta as any).env?.CONVEX_TIMEOUT_MS ?? process.env.CONVEX_TIMEOUT_MS;
const CONVEX_TIMEOUT_MS = Math.max(1000, Number(RAW_TIMEOUT_MS ?? 10000));

if (!CONVEX_URL) {
    throw new Error("CONVEX_URL environment variable is required");
}

const client = new ConvexHttpClient(CONVEX_URL);

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${label} timed out after ${CONVEX_TIMEOUT_MS}ms`));
        }, CONVEX_TIMEOUT_MS);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    }) as Promise<T>;
}

export const convex = {
    query: (name: string, args: Record<string, any>) =>
        withTimeout(client.query(name, args), `Convex query "${name}"`),
    mutation: (name: string, args: Record<string, any>) =>
        withTimeout(client.mutation(name, args), `Convex mutation "${name}"`),
};
