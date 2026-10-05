import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal .env loader (engine/.env or repo-root .env). Existing env vars win. */
export function loadEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, "..", ".env"), join(here, "..", "..", ".env")]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
