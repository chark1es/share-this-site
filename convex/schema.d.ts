declare const _default: import("convex/server").SchemaDefinition<{
    links: import("convex/server").TableDefinition<import("convex/values").VObject<{
        key?: string | undefined;
        url: string;
        createdAt: number;
        expireAt: number;
        visits: number;
        active: boolean;
    }, {
        key: import("convex/values").VString<string | undefined, "optional">;
        url: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        expireAt: import("convex/values").VFloat64<number, "required">;
        visits: import("convex/values").VFloat64<number, "required">;
        active: import("convex/values").VBoolean<boolean, "required">;
    }, "required", "key" | "url" | "createdAt" | "expireAt" | "visits" | "active">, {
        byKey: ["key", "_creationTime"];
    }, {}, {}>;
    snippets: import("convex/server").TableDefinition<import("convex/values").VObject<{
        key?: string | undefined;
        createdAt: number;
        expireAt: number;
        active: boolean;
        content: string;
        language: string;
        title: string;
        views: number;
    }, {
        key: import("convex/values").VString<string | undefined, "optional">;
        content: import("convex/values").VString<string, "required">;
        language: import("convex/values").VString<string, "required">;
        title: import("convex/values").VString<string, "required">;
        createdAt: import("convex/values").VFloat64<number, "required">;
        expireAt: import("convex/values").VFloat64<number, "required">;
        views: import("convex/values").VFloat64<number, "required">;
        active: import("convex/values").VBoolean<boolean, "required">;
    }, "required", "key" | "createdAt" | "expireAt" | "active" | "content" | "language" | "title" | "views">, {
        byKey: ["key", "_creationTime"];
    }, {}, {}>;
}, true>;
export default _default;
//# sourceMappingURL=schema.d.ts.map