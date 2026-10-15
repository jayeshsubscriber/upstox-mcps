/**
 * Loads .env before anything reads process.env. Imported first by
 * server/index.ts: modules such as upstox.ts read their tokens at import time.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const file = path.resolve(process.cwd(), ".env");
if (existsSync(file)) {
  // Values already set in the shell win over the file.
  process.loadEnvFile(file);
}
