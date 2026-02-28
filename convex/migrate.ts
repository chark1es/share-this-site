import { mutation } from "./_generated/server";

export const migrateLinks = mutation({
  handler: async (ctx) => {
    const links = await ctx.db.query("links").collect();
    for (const link of links) {
      if (!link.key) {
        await ctx.db.patch(link._id, { key: link._id });
      }
    }
    return `Migrated ${links.length} links`;
  },
});

export const migrateSnippets = mutation({
  handler: async (ctx) => {
    const snippets = await ctx.db.query("snippets").collect();
    for (const snippet of snippets) {
      if (!snippet.key) {
        await ctx.db.patch(snippet._id, { key: snippet._id });
      }
    }
    return `Migrated ${snippets.length} snippets`;
  },
});
