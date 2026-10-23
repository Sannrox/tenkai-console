// Initial JS budget: the gzipped size of every script dist/index.html loads
// up front (entry chunks and their modulepreloads), not lazily loaded routes.
//   node scripts/bundle-budget.mjs check    fail above 200 KB or 10% over the baseline
//   node scripts/bundle-budget.mjs update   record the current size as the baseline
import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";

const BASELINE = "perf/bundle-baseline.json";
const LIMIT_BYTES = 200 * 1024;
const GROWTH = 0.1;

const initialBytes = async () => {
  const html = await readFile("dist/index.html", "utf8");
  const scripts = [
    ...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g),
    ...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g),
  ].map((match) => match[1].replace(/^\.?\//, ""));
  let total = 0;
  for (const script of new Set(scripts)) {
    total += gzipSync(await readFile(`dist/${script}`), { level: 9 }).length;
  }
  return total;
};

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const [command] = process.argv.slice(2);
const bytes = await initialBytes();
if (command === "update") {
  await writeFile(BASELINE, `${JSON.stringify({ initial_js_gzip_bytes: bytes }, null, 2)}\n`);
  console.log(`baseline: initial JS ${kb(bytes)} gzipped`);
} else if (command === "check") {
  const { initial_js_gzip_bytes: baseline } = JSON.parse(await readFile(BASELINE, "utf8"));
  const limit = Math.min(LIMIT_BYTES, Math.floor(baseline * (1 + GROWTH)));
  console.log(`initial JS ${kb(bytes)} gzipped (baseline ${kb(baseline)}, limit ${kb(limit)})`);
  if (bytes > limit) {
    console.error(
      `initial JS is over budget; shrink it, or if the growth is intended run \`pnpm perf:bundle:update\``,
    );
    process.exit(1);
  }
} else {
  throw new Error("usage: bundle-budget.mjs check | update");
}
