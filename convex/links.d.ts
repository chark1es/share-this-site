export declare const getLink: import("convex/server").RegisteredQuery<"public", {
    key: string;
}, Promise<{
    _id: import("convex/values").GenericId<"links">;
    _creationTime: number;
    key?: string | undefined;
    url: string;
    createdAt: number;
    expireAt: number;
    visits: number;
    active: boolean;
} | null>>;
export declare const createLink: import("convex/server").RegisteredMutation<"public", {
    key: string;
    url: string;
    createdAt: number;
    expireAt: number;
}, Promise<string | null>>;
export declare const updateLink: import("convex/server").RegisteredMutation<"public", {
    key: string;
    url: string;
    createdAt: number;
    expireAt: number;
}, Promise<string | null>>;
export declare const incrementVisits: import("convex/server").RegisteredMutation<"public", {
    key: string;
}, Promise<void>>;
export declare const deleteLink: import("convex/server").RegisteredMutation<"public", {
    key: string;
}, Promise<void>>;
//# sourceMappingURL=links.d.ts.map