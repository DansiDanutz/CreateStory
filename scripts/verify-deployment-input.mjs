#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const ignoredDirectories = new Set([
  ".git",
  ".next",
  ".omx",
  ".vercel",
  "coverage",
  "node_modules",
]);
const forbiddenEnvironmentFile = (name) =>
  name === ".env" || (name.startsWith(".env.") && name !== ".env.example");

async function walk(directory, retained = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path, retained);
    else retained.push(path);
  }
  return retained;
}

const files = await walk(root);
const leakedEnvironmentFiles = files
  .filter((path) => forbiddenEnvironmentFile(basename(path)))
  .filter((path) => {
    const ignored = spawnSync("git", ["check-ignore", "--quiet", "--", path], {
      cwd: root,
      stdio: "ignore",
    });
    return ignored.status !== 0;
  })
  .map((path) => path.replace(root, ""));
assert.deepEqual(
  leakedEnvironmentFiles,
  [],
  `credential-bearing environment files entered the deployment input: ${leakedEnvironmentFiles.join(", ")}`,
);

const vercelIgnore = await readFile(new URL("../.vercelignore", import.meta.url), "utf8");
for (const requiredPattern of [".env", ".env.*", "!.env.example"]) {
  assert.ok(
    vercelIgnore.split(/\r?\n/u).includes(requiredPattern),
    `.vercelignore must contain ${requiredPattern}`,
  );
}

console.log(
  `deployment input: PASS (${files.length} local files; no unignored credential environment file)`,
);
