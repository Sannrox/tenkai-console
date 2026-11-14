// Tenkai HTTP contract: vendored schema and generated types.
// api/tenkai.pin holds "<ref> <schema sha256>", the same shape as tenkai's own
// ui/console.pin. <ref> is a release tag, or a full commit on tenkai main while
// the console builds UI for features that ship in the next tenkai release.
//   node scripts/api.mjs sync <tag>     download the release's schema asset, check it against
//                                       the release SHA256SUMS, then pin and regenerate
//   node scripts/api.mjs sync <commit>  vendor the schema at a commit on tenkai main, then
//                                       pin and regenerate
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
const REPO_API = "https://api.github.com/repos/Sannrox/tenkai";
const CONTRACT = "tenkai.http.v1";
const TAG = /^v\d+\.\d+\.\d+$/;
const COMMIT = /^[0-9a-f]{40}$/;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

const readPin = async () => {
  const [ref, digest] = (await readFile(PIN, "utf8")).trim().split(/\s+/);
  if (!(TAG.test(ref ?? "") || COMMIT.test(ref ?? "")) || !/^[0-9a-f]{64}$/.test(digest ?? "")) {
    throw new Error(`${PIN} must be "<vX.Y.Z or 40-hex commit> <sha256>"`);
  }
  return { ref, digest };
};

const get = async (url, accept) => {
  const response = await fetch(url, accept ? { headers: { accept } } : undefined);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response;
};

const download = async (tag, name) => (await get(`${RELEASES}/download/${tag}/${name}`)).text();

// How `head` relates to `base` in tenkai history: "ahead", "identical", "behind", or "diverged".
const compare = async (base, head) =>
  (await (await get(`${REPO_API}/compare/${base}...${head}`, "application/vnd.github+json")).json())
    .status;

// A release schema must match the release SHA256SUMS. A commit has no published
// checksum, so it must be on tenkai main and keep the contract id the server
// reports on /healthz.
const fetchSchema = async (ref) => {
  if (TAG.test(ref)) {
    const [schema, sums] = await Promise.all([download(ref, ASSET), download(ref, "SHA256SUMS")]);
    const listed = sums
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === ASSET)?.[0];
    if (listed !== sha256(schema)) {
      throw new Error(
        `${ASSET} at ${ref} has sha256 ${sha256(schema)}, SHA256SUMS lists ${listed}`,
      );
    }
    return schema;
  }
  if (!COMMIT.test(ref)) {
    throw new Error("sync needs a tenkai release tag (vX.Y.Z) or a full 40-hex commit on main");
  }
  if (!["behind", "identical"].includes(await compare("main", ref))) {
    throw new Error(`${ref} is not on tenkai main`);
  }
  const schema = await (
    await get(`https://raw.githubusercontent.com/Sannrox/tenkai/${ref}/${SCHEMA}`)
  ).text();
  const id = JSON.parse(schema).$id;
  if (id !== CONTRACT) {
    throw new Error(`${SCHEMA} at ${ref} is contract ${id}, expected ${CONTRACT}`);
  }
  return schema;
};

const generate = async () => {
  const doc = JSON.parse(await readFile(SCHEMA, "utf8"));
  const { ref, digest } = await readPin();
  const source = TAG.test(ref) ? `release ${ref}` : `commit ${ref}`;
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
    bannerComment: `// Generated from Sannrox/tenkai ${source} ${ASSET} (sha256 ${digest}, contract ${doc.$id}).\n// Do not edit: run \`pnpm api:gen\`.`,
    additionalProperties: false,
    declareExternallyReferenced: true,
    unreachableDefinitions: true,
    format: false,
  });
  return `${ts}\nexport const TENKAI_CONTRACT = ${JSON.stringify(doc.$id)};\n`;
};

const [command, arg] = process.argv.slice(2);
if (command === "sync") {
  const schema = await fetchSchema(arg ?? "");
  const digest = sha256(schema);
  await writeFile(SCHEMA, schema);
  await writeFile(PIN, `${arg} ${digest}\n`);
  await writeFile(OUT, await generate());
} else if (command === "gen") {
  await writeFile(OUT, await generate());
} else if (command === "check") {
  const { ref, digest } = await readPin();
  const actual = sha256(await readFile(SCHEMA, "utf8"));
  if (actual !== digest) {
    console.error(`${SCHEMA} has sha256 ${actual}, ${PIN} pins ${ref} at ${digest}`);
    process.exit(1);
  }
  if ((await readFile(OUT, "utf8")) !== (await generate())) {
    console.error(`${OUT} is stale; run \`pnpm api:gen\``);
    process.exit(1);
  }
} else if (command === "drift") {
  // Tenkai ships the contract as a release asset; a console pinned to an older
  // release misses fields and routes newer servers already have. A commit pin is
  // current while it descends from the latest release.
  const latest = await get(`${REPO_API}/releases/latest`, "application/vnd.github+json");
  const { tag_name: tag } = await latest.json();
  const pin = await readPin();
  const current = COMMIT.test(pin.ref)
    ? ["behind", "identical"].includes(await compare(pin.ref, tag))
    : tag === pin.ref || sha256(await download(tag, ASSET)) === pin.digest;
  if (!current) {
    console.error(`${PIN} (${pin.ref}) is behind tenkai ${tag}; run \`pnpm api:sync ${tag}\``);
    process.exit(1);
  }
} else {
  throw new Error("usage: api.mjs sync <tag|commit> | gen | check | drift");
}
