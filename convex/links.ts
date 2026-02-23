import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

export const getLink = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db.query("links").withIndex("byKey", (q) => q.eq("key", args.key)).first();
    return link;
  },
});

export const createLink = mutation({
  args: {
    key: v.string(),
    url: v.string(),
    createdAt: v.number(),
    expireAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("links").withIndex("byKey", (q) => q.eq("key", args.key)).first();
    if (existing) {
      return null;
    }
    await ctx.db.insert("links", {
      key: args.key,
      url: args.url,
      createdAt: args.createdAt,
      expireAt: args.expireAt,
      visits: 0,
      active: true,
    });
    return args.key;
  },
});

export const updateLink = mutation({
  args: {
    key: v.string(),
    url: v.string(),
    createdAt: v.number(),
    expireAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("links").withIndex("byKey", (q) => q.eq("key", args.key)).first();
    if (!existing) {
      return null;
    }
    await ctx.db.patch(existing._id, {
      url: args.url,
      createdAt: args.createdAt,
      expireAt: args.expireAt,
      visits: 0,
      active: true,
    });
    return args.key;
  },
});

export const incrementVisits = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db.query("links").withIndex("byKey", (q) => q.eq("key", args.key)).first();
    if (link) {
      await ctx.db.patch(link._id, { visits: link.visits + 1 });
    }
  },
});

export const deleteLink = mutation({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const link = await ctx.db.query("links").withIndex("byKey", (q) => q.eq("key", args.key)).first();
    if (link) {
      await ctx.db.delete(link._id);
    }
  },
});
