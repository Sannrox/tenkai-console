// Tenkai HTTP contract: vendored schema and generated types.
//   node scripts/api.mjs sync <tenkai-commit>  download api/tenkai-http-v1.schema.json at that commit
//   node scripts/api.mjs gen                   write src/api/tenkai.gen.ts from the vendored schema
//   node scripts/api.mjs check                 fail when src/api/tenkai.gen.ts is stale
//   node scripts/api.mjs drift                 fail when the vendored schema is behind tenkai main
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const SCHEMA = "api/tenkai-http-v1.schema.json";
const REF = "api/TENKAI_REF";
const OUT = "src/api/tenkai.gen.ts";

const generate = async () => {
  const doc = JSON.parse(await readFile(SCHEMA, "utf8"));
  const ref = (await readFile(REF, "utf8")).trim();
  const names = Object.keys(doc.$defs).toSorted();
  // Wrap every $def so each becomes an exported type.
  const wrapper = {
    title: "TenkaiHttpV1",
    type: "object",
    properties: Object.fromEntries(names.map((name) => [name, { $ref: `#/$defs/${name}` }])),
    additionalProperties: false,
    $defs: doc.$defs,
  };
  const ts = await compile(wrapper, "TenkaiHttpV1", {
    bannerComment: `// Generated from Sannrox/tenkai ${SCHEMA} at ${ref} (contract ${doc.$id}).\n// Do not edit: run \`pnpm api:gen\`.`,
    additionalProperties: false,
    declareExternallyReferenced: true,
    unreachableDefinitions: true,
    format: false,
  });
  return `${ts}\nexport const TENKAI_CONTRACT = ${JSON.stringify(doc.$id)};\n`;
};

const [command, arg] = process.argv.slice(2);
if (command === "sync") {
  if (!/^[0-9a-f]{40}$/.test(arg ?? "")) {
    throw new Error("sync needs a full 40-character tenkai commit SHA");
  }
  const url = `https://raw.githubusercontent.com/Sannrox/tenkai/${arg}/${SCHEMA}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  await writeFile(SCHEMA, await response.text());
  await writeFile(REF, `${arg}\n`);
  await writeFile(OUT, await generate());
} else if (command === "gen") {
  await writeFile(OUT, await generate());
} else if (command === "check") {
  if ((await readFile(OUT, "utf8")) !== (await generate())) {
    console.error(`${OUT} is stale; run \`pnpm api:gen\``);
    process.exit(1);
  }
} else if (command === "drift") {
  // The contract tenkai serves is the one on its main branch; a console built
  // against an older schema misses fields and routes the server already has.
  const head = await fetch("https://api.github.com/repos/Sannrox/tenkai/commits/main", {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!head.ok) {
    throw new Error(`tenkai main: HTTP ${head.status}`);
  }
  const { sha } = await head.json();
  const url = `https://raw.githubusercontent.com/Sannrox/tenkai/${sha}/${SCHEMA}`;
  const latest = await fetch(url);
  if (!latest.ok) {
    throw new Error(`${url}: HTTP ${latest.status}`);
  }
  const same =
    JSON.stringify(JSON.parse(await latest.text())) ===
    JSON.stringify(JSON.parse(await readFile(SCHEMA, "utf8")));
  if (!same) {
    const ref = (await readFile(REF, "utf8")).trim();
    console.error(
      `${SCHEMA} (tenkai ${ref}) is behind tenkai main ${sha}; run \`pnpm api:sync ${sha}\``,
    );
    process.exit(1);
  }
} else {
  throw new Error("usage: api.mjs sync <sha> | gen | check | drift");
}
