export declare const getSnippet: import("convex/server").RegisteredQuery<"public", {
    key: string;
}, Promise<{
    _id: import("convex/values").GenericId<"snippets">;
    _creationTime: number;
    key?: string | undefined;
    createdAt: number;
    expireAt: number;
    active: boolean;
    content: string;
    language: string;
    title: string;
    views: number;
} | null>>;
export declare const createSnippet: import("convex/server").RegisteredMutation<"public", {
    key: string;
    createdAt: number;
    expireAt: number;
    content: string;
    language: string;
    title: string;
}, Promise<string | null>>;
export declare const updateSnippet: import("convex/server").RegisteredMutation<"public", {
    key: string;
    createdAt: number;
    expireAt: number;
    content: string;
    language: string;
    title: string;
}, Promise<string | null>>;
export declare const incrementViews: import("convex/server").RegisteredMutation<"public", {
    key: string;
}, Promise<void>>;
export declare const deleteSnippet: import("convex/server").RegisteredMutation<"public", {
    key: string;
}, Promise<void>>;
//# sourceMappingURL=snippets.d.ts.map