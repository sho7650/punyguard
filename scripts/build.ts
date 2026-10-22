// Builds the unpacked extension into dist/.
// Usage: node scripts/build.ts [--watch]
import { readdirSync, statSync, watch } from "node:fs";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";
import packageJson from "../package.json" with { type: "json" };
import { settingsScripts } from "../src/service-worker-navigation/settings-script.ts";

const OUT_DIR = "dist";

// The output name of each bundled script, which manifest.json and the pages refer to. The
// output names stay as they are when the sources move or are renamed: the warning page's URL
// (blocked.html) is in the users' browser history and in the redirects of their block rules.
const ENTRY_POINTS: Readonly<Record<string, string>> = {
  background: "src/background.entry.ts",
  blocked: "src/warning-page/warning-page.entry.ts",
  content: "src/service-worker-navigation/content.entry.ts",
  options: "src/settings/options.entry.ts",
};

interface StaticFile {
  readonly from: string;
  readonly to: string;
}

// Runtime dependencies end up inside the bundled scripts, so their license notices have to
// ship in dist/ (and the Release zip) too.
function dependencyLicenses(): StaticFile[] {
  return Object.keys(packageJson.dependencies).map((name) => {
    const directory = `node_modules/${name}`;
    const license = readdirSync(directory).find((file) => /^licen[cs]e/iu.test(file));
    // The dependencies are fixed in package.json and each ships a license file; this only gives
    // a clearer message than cp would if one ever went missing.
    if (license === undefined) {
      throw new Error(`No license file for the dependency ${name} in ${directory}`);
    }
    return { from: `${directory}/${license}`, to: `licenses/${name}.txt` };
  });
}

// Files that are not bundled and are copied into dist/ as they are, under the fixed output
// names (ENTRY_POINTS).
const STATIC_FILES: readonly StaticFile[] = [
  { from: "manifest.json", to: "manifest.json" },
  { from: "src/warning-page/warning-page.html", to: "blocked.html" },
  { from: "src/warning-page/warning-page.css", to: "blocked.css" },
  { from: "src/settings/options.html", to: "options.html" },
  { from: "src/settings/options.css", to: "options.css" },
  { from: "_locales", to: "_locales" },
  { from: "icons", to: "icons" },
  { from: "LICENSE", to: "LICENSE" },
  ...dependencyLicenses(),
];

const buildOptions: esbuild.BuildOptions = {
  entryPoints: ENTRY_POINTS,
  outdir: OUT_DIR,
  bundle: true,
  // A classic script works both as the service worker and from the extension pages,
  // so the manifest needs no "type": "module".
  format: "iife",
  platform: "browser",
  // Left unminified so the shipped code can be reviewed as it is.
  minify: false,
  logLevel: "info",
};

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

// The scripts that hand the content script its settings, one per combination of settings
// (src/service-worker-navigation/settings-script.ts). They only change with the source, so watch
// mode writes them once.
async function writeSettingsScripts(): Promise<void> {
  await Promise.all(
    settingsScripts().map(async ({ path: file, source }) => {
      await mkdir(path.dirname(`${OUT_DIR}/${file}`), { recursive: true });
      await writeFile(`${OUT_DIR}/${file}`, source);
    }),
  );
}

async function buildOnce(): Promise<void> {
  await esbuild.build(buildOptions);
  await copyStaticFiles();
  await writeSettingsScripts();
}

async function buildAndWatch(): Promise<void> {
  const context = await esbuild.context(buildOptions);
  await context.watch();
  await copyStaticFiles();
  await writeSettingsScripts();
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
