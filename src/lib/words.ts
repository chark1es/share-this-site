let generator: any | null = null;

async function loadGenerator() {
    if (generator) return generator;
    const mod: any = await import("random-words");
    const gen = mod.generate ?? mod.default?.generate ?? mod.default ?? mod;
    generator = gen;
    return generator;
}

export async function pickWord(): Promise<string> {
    const generate: any = await loadGenerator();
    for (let i = 0; i < 20; i++) {
        const out = generate({ exactly: 1, maxLength: 12 });
        const raw = Array.isArray(out) ? out[0] : out;
        const clean = String(raw)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
        if (clean && clean.length >= 3 && clean.length <= 18) return clean;
    }
    return Math.random().toString(36).slice(2, 8);
}
