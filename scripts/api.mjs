// Tenkai HTTP contract: vendored schema and generated types.
// api/tenkai.pin holds "<tenkai release tag> <schema sha256>", the same shape as
// tenkai's own ui/console.pin.
//   node scripts/api.mjs sync <tag>  download the release's schema asset, check it against
//                                    the release SHA256SUMS, then pin and regenerate
//   node scripts/api.mjs gen         write src/api/tenkai.gen.ts from the vendored schema
//   node scripts/api.mjs check       fail when the schema does not match the pin or the types are stale
//   node scripts/api.mjs drift       fail when the pin is behind tenkai's latest release
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { compile } from "json-schema-to-typescript";

const SCHEMA = "api/tenkai-http-v1.schema.json";
const ASSET = "tenkai-http-v1.schema.json";
const PIN = "api/tenkai.pin";
const OUT = "src/api/tenkai.gen.ts";
const RELEASES = "https://github.com/Sannrox/tenkai/releases";

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const readPin = async () => {
  const [tag, digest] = (await readFile(PIN, "utf8")).trim().split(/\s+/);
  if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !/^[0-9a-f]{64}$/.test(digest ?? "")) {
    throw new Error(`${PIN} must be "<vX.Y.Z> <sha256>"`);
  }
  return { tag, digest };
};

const download = async (tag, name) => {
  const url = `${RELEASES}/download/${tag}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.text();
};

const generate = async () => {
  const doc = JSON.parse(await readFile(SCHEMA, "utf8"));
  const { tag, digest } = await readPin();
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
    bannerComment: `// Generated from Sannrox/tenkai release ${tag} ${ASSET} (sha256 ${digest}, contract ${doc.$id}).\n// Do not edit: run \`pnpm api:gen\`.`,
    additionalProperties: false,
    declareExternallyReferenced: true,
    unreachableDefinitions: true,
    format: false,
  });
  return `${ts}\nexport const TENKAI_CONTRACT = ${JSON.stringify(doc.$id)};\n`;
};

const [command, arg] = process.argv.slice(2);
if (command === "sync") {
  if (!/^v\d+\.\d+\.\d+$/.test(arg ?? "")) {
    throw new Error("sync needs a tenkai release tag (vX.Y.Z)");
  }
  const [schema, sums] = await Promise.all([download(arg, ASSET), download(arg, "SHA256SUMS")]);
  const listed = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === ASSET)?.[0];
  const digest = sha256(schema);
  if (listed !== digest) {
    throw new Error(`${ASSET} at ${arg} has sha256 ${digest}, SHA256SUMS lists ${listed}`);
  }
  await writeFile(SCHEMA, schema);
  await writeFile(PIN, `${arg} ${digest}\n`);
  await writeFile(OUT, await generate());
} else if (command === "gen") {
  await writeFile(OUT, await generate());
} else if (command === "check") {
  const { tag, digest } = await readPin();
  const actual = sha256(await readFile(SCHEMA, "utf8"));
  if (actual !== digest) {
    console.error(`${SCHEMA} has sha256 ${actual}, ${PIN} pins ${tag} at ${digest}`);
    process.exit(1);
  }
  if ((await readFile(OUT, "utf8")) !== (await generate())) {
    console.error(`${OUT} is stale; run \`pnpm api:gen\``);
    process.exit(1);
  }
} else if (command === "drift") {
  // Tenkai ships the contract as a release asset; a console pinned to an older
  // release misses fields and routes newer servers already have.
  const latest = await fetch("https://api.github.com/repos/Sannrox/tenkai/releases/latest", {
    headers: { accept: "application/vnd.github+json" },
  });
  if (!latest.ok) {
    throw new Error(`tenkai latest release: HTTP ${latest.status}`);
  }
  const { tag_name: tag } = await latest.json();
  const pin = await readPin();
  if (tag !== pin.tag && sha256(await download(tag, ASSET)) !== pin.digest) {
    console.error(`${PIN} (${pin.tag}) is behind tenkai ${tag}; run \`pnpm api:sync ${tag}\``);
    process.exit(1);
  }
} else {
  throw new Error("usage: api.mjs sync <tag> | gen | check | drift");
}
