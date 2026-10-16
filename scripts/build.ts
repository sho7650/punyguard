// Builds the unpacked extension into dist/.
// Usage: node scripts/build.ts [--watch]
import { statSync, watch } from "node:fs";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";

const OUT_DIR = "dist";

const ENTRY_POINTS = ["src/background.ts", "src/blocked.ts"];

// Files that are not bundled and are copied into dist/ as they are.
const STATIC_FILES = [
  { from: "manifest.json", to: "manifest.json" },
  { from: "src/blocked.html", to: "blocked.html" },
  { from: "src/blocked.css", to: "blocked.css" },
  { from: "_locales", to: "_locales" },
  { from: "icons", to: "icons" },
] as const;

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ENTRY_POINTS,
  outdir: OUT_DIR,
  bundle: true,
  // A classic script works both as the service worker and from blocked.html,
  // so the manifest needs no "type": "module".
  format: "iife",
  platform: "browser",
  // Left unminified so the shipped code can be reviewed as it is.
  minify: false,
  logLevel: "info",
};

type StaticFile = (typeof STATIC_FILES)[number];

async function copyStaticFile({ from, to }: StaticFile): Promise<void> {
  await cp(from, `${OUT_DIR}/${to}`, { recursive: true });
}

async function copyStaticFiles(): Promise<void> {
  await Promise.all(STATIC_FILES.map((file) => copyStaticFile(file)));
}

// One save can fire several watch events. Running the copies one after another keeps
// two copies of the same file from overwriting each other halfway.
function createSerialQueue(): (task: () => Promise<void>) => void {
  let tail = Promise.resolve();
  return (task) => {
    tail = tail.then(task).catch((error: unknown) => {
      console.error("Failed to copy static files:", error);
    });
  };
}

// Calls onChange whenever the static file (or anything inside a static directory) changes.
// A file is watched through its parent directory: editors often save by writing a temporary
// file and renaming it over the original, and a watcher on the file itself would stay on the
// replaced inode and miss every later save.
function watchStaticFile(file: StaticFile, onChange: () => void): void {
  if (statSync(file.from).isDirectory()) {
    watch(file.from, { recursive: true }, onChange);
    return;
  }
  const name = path.basename(file.from);
  watch(path.dirname(file.from), (_event, filename) => {
    // fs.watch may leave out the file name; copying again is harmless, so treat it as a match.
    if (filename === null || filename === name) {
      onChange();
    }
  });
}

async function buildOnce(): Promise<void> {
  await esbuild.build(buildOptions);
  await copyStaticFiles();
}

async function buildAndWatch(): Promise<void> {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  await copyStaticFiles();
  // esbuild only watches the bundled sources, so the static files need their own watcher.
  const enqueue = createSerialQueue();
  for (const file of STATIC_FILES) {
    watchStaticFile(file, () => {
      enqueue(() => copyStaticFile(file));
    });
  }
  console.log("Watching for changes...");
}

await rm(OUT_DIR, { recursive: true, force: true });
if (process.argv.includes("--watch")) {
  await buildAndWatch();
} else {
  await buildOnce();
}
