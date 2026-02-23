import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
export const getSnippet = query({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const snippet = await ctx.db.query("snippets").withIndex("byKey", (q) => q.eq("key", args.key)).first();
        return snippet;
    },
});
export const createSnippet = mutation({
    args: {
        key: v.string(),
        content: v.string(),
        language: v.string(),
        title: v.string(),
        createdAt: v.number(),
        expireAt: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("snippets").withIndex("byKey", (q) => q.eq("key", args.key)).first();
        if (existing) {
            return null;
        }
        await ctx.db.insert("snippets", {
            key: args.key,
            content: args.content,
            language: args.language,
            title: args.title,
            createdAt: args.createdAt,
            expireAt: args.expireAt,
            views: 0,
            active: true,
        });
        return args.key;
    },
});
export const updateSnippet = mutation({
    args: {
        key: v.string(),
        content: v.string(),
        language: v.string(),
        title: v.string(),
        createdAt: v.number(),
        expireAt: v.number(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("snippets").withIndex("byKey", (q) => q.eq("key", args.key)).first();
        if (!existing) {
            return null;
        }
        await ctx.db.patch(existing._id, {
            content: args.content,
            language: args.language,
            title: args.title,
            createdAt: args.createdAt,
            expireAt: args.expireAt,
            views: 0,
            active: true,
        });
        return args.key;
    },
});
export const incrementViews = mutation({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const snippet = await ctx.db.query("snippets").withIndex("byKey", (q) => q.eq("key", args.key)).first();
        if (snippet) {
            await ctx.db.patch(snippet._id, { views: snippet.views + 1 });
        }
    },
});
export const deleteSnippet = mutation({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const snippet = await ctx.db.query("snippets").withIndex("byKey", (q) => q.eq("key", args.key)).first();
        if (snippet) {
            await ctx.db.delete(snippet._id);
        }
    },
});
