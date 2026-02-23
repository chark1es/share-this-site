import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  links: defineTable({
    key: v.optional(v.string()),
    url: v.string(),
    createdAt: v.number(),
    expireAt: v.number(),
    visits: v.number(),
    active: v.boolean(),
  }).index("byKey", ["key"]),

  snippets: defineTable({
    key: v.optional(v.string()),
    content: v.string(),
    language: v.string(),
    title: v.string(),
    createdAt: v.number(),
    expireAt: v.number(),
    views: v.number(),
    active: v.boolean(),
  }).index("byKey", ["key"]),
});
