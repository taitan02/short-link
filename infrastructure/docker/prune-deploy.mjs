// Removes build-time-only packages from a `pnpm deploy --prod` output directory.
//
// @prisma/client declares the Prisma CLI and TypeScript as peer dependencies. They are needed to
// generate the client, never at runtime (its runtime files require neither), but pnpm links them
// into every deploy, together with their own dependencies (~200 MB: CLI, Studio, pglite, tsc).
//
// Rather than deleting a hard-coded list, this cuts only those peer edges and deletes every
// package in node_modules/.pnpm that is then unreachable from the app's own dependencies.
//
// Usage: node prune-deploy.mjs <deploy-dir>
import { lstatSync, readdirSync, readlinkSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const BUILD_ONLY_PEERS = { '@prisma/client': ['prisma', 'typescript'] };

const root = resolve(process.argv[2] ?? '.');
const modules = join(root, 'node_modules');
const store = join(modules, '.pnpm');

// Lists package entries (scoped ones included) in a node_modules directory.
function entries(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    if (name === '.pnpm' || name === '.bin' || name.startsWith('.')) return [];
    if (name.startsWith('@')) return readdirSync(join(dir, name)).map((n) => `${name}/${n}`);
    return [name];
  });
}

// node_modules/.pnpm/<key>/node_modules/<name> -> <key>
function storeKey(path) {
  const rel = relative(store, path);
  return rel.startsWith('..') ? undefined : rel.split(sep)[0];
}

for (const [pkg, peers] of Object.entries(BUILD_ONLY_PEERS)) {
  const prefix = `${pkg.replace('/', '+')}@`;
  for (const key of readdirSync(store).filter((k) => k.startsWith(prefix))) {
    for (const peer of peers) rmSync(join(store, key, 'node_modules', peer), { force: true });
  }
}

const reachable = new Set();
const queue = entries(modules).map((name) => realpathSync(join(modules, name)));
while (queue.length > 0) {
  const key = storeKey(queue.pop());
  if (key === undefined || reachable.has(key)) continue;
  reachable.add(key);
  // A package's dependencies are the other entries next to it in its store folder.
  const siblings = join(store, key, 'node_modules');
  for (const name of entries(siblings)) {
    const path = join(siblings, name);
    if (lstatSync(path).isSymbolicLink() || storeKey(path) === key) queue.push(realpathSync(path));
  }
}

let removed = 0;
for (const key of readdirSync(store)) {
  if (key === 'node_modules' || key.startsWith('.') || reachable.has(key)) continue;
  rmSync(join(store, key), { recursive: true, force: true });
  removed++;
}

// pnpm's hidden hoisting directory may now point at deleted packages.
const hoisted = join(store, 'node_modules');
for (const name of entries(hoisted)) {
  const path = join(hoisted, name);
  if (
    lstatSync(path).isSymbolicLink() &&
    !existsSync(resolve(join(path, '..'), readlinkSync(path)))
  ) {
    rmSync(path, { force: true });
  }
}

console.log(`prune-deploy: kept ${reachable.size} packages, removed ${removed} from ${root}`);
