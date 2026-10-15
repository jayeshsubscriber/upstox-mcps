/**
 * Builds the Vercel deployment in Vercel's Build Output API format
 * (.vercel/output): the app as static files on the CDN, and the whole API as
 * one bundled Node function in Mumbai (bom1, next to the Scanners database
 * and Upstox). Runs after `npm run build`; Vercel's build command is
 * `npm run vercel-build` (vercel.json).
 */
import { build } from "esbuild";
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { downloadNse } from "../server/instruments";

const root = process.cwd();
const out = path.join(root, ".vercel", "output");
const fn = path.join(out, "functions", "api", "index.func");
const data = path.join(root, "data");

rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(fn, "data"), { recursive: true });

// The instrument list ships with the function, so a cold start never downloads it.
try {
  const list = await downloadNse();
  writeFileSync(path.join(data, "instruments-nse.json"), JSON.stringify(list));
  console.log(`instruments: ${list.length} NSE symbols`);
} catch (e) {
  console.warn(`instruments: couldn't download (${(e as Error).message}); ${existsSync(path.join(data, "instruments-nse.json")) ? "using the cached copy" : "the function will use the Nifty 500 list"}`);
}
for (const f of ["nifty500.csv", "instruments-nse.json"]) if (existsSync(path.join(data, f))) copyFileSync(path.join(data, f), path.join(fn, "data", f));

// The app.
if (!existsSync(path.join(root, "web", "dist", "index.html"))) throw new Error("web/dist is missing: run `npm run build` first");
cpSync(path.join(root, "web", "dist"), path.join(out, "static"), { recursive: true });

// The API, one file.
await build({
  entryPoints: [path.join(root, "server", "vercel.ts")],
  outfile: path.join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
});

writeFileSync(
  path.join(fn, ".vc-config.json"),
  JSON.stringify(
    {
      runtime: "nodejs22.x",
      handler: "index.mjs",
      launcherType: "Nodejs",
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      // Agent checks and long answers take a while; 300 s is the Hobby plan's most.
      maxDuration: 300,
      regions: ["bom1"],
    },
    null,
    2,
  ),
);

writeFileSync(
  path.join(out, "config.json"),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "^/assets/(.*)$", headers: { "cache-control": "public, max-age=31536000, immutable" }, continue: true },
        { handle: "filesystem" },
        // The function reads the original path from __p (req.url may show the rewritten one).
        { src: "^/api/(.*)$", dest: "/api/index?__p=$1" },
        { src: "^/(.*)$", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

console.log(`Built ${path.relative(root, out)}: static app + api function (bom1)`);
