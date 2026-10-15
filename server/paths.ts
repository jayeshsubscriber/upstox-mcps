/** Where files live: data/ in the repo locally; next to the bundle on Vercel (set by server/vercel.ts). */
import path from "node:path";

export const dataDir = () => process.env.AGENTS_DATA_DIR ?? path.resolve(process.cwd(), "data");
