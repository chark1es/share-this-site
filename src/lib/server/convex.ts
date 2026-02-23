import { ConvexHttpClient } from "convex/browser";

const CONVEX_URL = (import.meta as any).env?.CONVEX_URL ?? process.env.CONVEX_URL;

if (!CONVEX_URL) {
    throw new Error("CONVEX_URL environment variable is required");
}

const client = new ConvexHttpClient(CONVEX_URL);

export const convex = {
    query: (name: string, args: Record<string, any>) => client.query(name, args),
    mutation: (name: string, args: Record<string, any>) => client.mutation(name, args),
};
