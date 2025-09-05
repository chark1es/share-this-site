import { createRequire } from "module";

// Use Node ESM-compatible require to load CJS package
const require = createRequire(import.meta.url);
const randomWordsModule = require("random-words");
const randomWords = randomWordsModule.generate;

// Generate a single, URL-safe word
export function pickWord(): string {
    for (let i = 0; i < 20; i++) {
        const out = randomWords({ exactly: 1, maxLength: 12 });
        const raw = Array.isArray(out) ? out[0] : out;
        const clean = String(raw)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        if (clean && clean.length >= 3 && clean.length <= 18) return clean;
    }
    // Fallback to random base36 if library returns something unusable repeatedly
    return Math.random().toString(36).slice(2, 8);
}
