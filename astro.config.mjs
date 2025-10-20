// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

import node from "@astrojs/node";
import react from "@astrojs/react";

// https://astro.build/config
export default defineConfig({
    integrations: [react()],
    vite: {
        plugins: [tailwindcss()],
        optimizeDeps: {
            include: [
                "@mantine/core",
                "@mantine/hooks",
                "@mantine/notifications",
                "@tabler/icons-react",
            ],
        },
    },
    output: "server",
    adapter: node({
        mode: "standalone",
    }),

    server: {
        host: true,
        port: process.env.PORT ? Number(process.env.PORT) : 8080,
    },
});
