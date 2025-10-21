import express from "express";
import { createServer } from "http";

const app = express();
const port = process.env.PORT || 8080;

// Import Astro handler dynamically after build
let ssrHandler: any;
try {
    const astroModule = await import("../dist/server/entry.mjs");
    ssrHandler = astroModule.handler;
    console.log("✅ Astro SSR handler loaded");
} catch (err) {
    console.error("❌ Failed to load Astro SSR handler:", err);
    process.exit(1);
}

// Use Astro's SSR handler
app.use(ssrHandler);

// Create HTTP server
const server = createServer(app);

server.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});

server.on("error", (err) => {
    console.error("❌ Server error:", err);
    process.exit(1);
});
