import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyPaths } from "./classify-paths.mjs";

export const FAN_IN_THRESHOLD = 3;
export const BROAD = new Set([
  "src/components/Button.astro",
  "src/consts.ts",
  "src/content.config.ts",
]);
export const BROAD_PREFIXES = [
  "src/layouts/",
  "src/styles/",
  "src/assets/fonts/",
  "src/components/wrapper/",
  "src/components/typography/",
  "src/utils/",
  "tests/fixtures/",
  "public/",
];

export const SPEC_SOURCES = {
  "tests/attire.spec.ts": ["src/components/sections/Attire.astro"],
  "tests/button-hover.spec.ts": ["*"],
  "tests/entourage.spec.ts": [
    "src/components/sections/Entourage.astro",
    "src/content/entourage/",
  ],
  "tests/explore.spec.ts": [
    "src/components/sections/Explore.astro",
    "src/content/explore/",
  ],
  "tests/faq.spec.ts": [
    "src/components/sections/Faq.astro",
    "src/content/faq/",
    "src/components/interactive/Accordion.astro",
    "src/components/interactive/AccordionItem.astro",
  ],
  "tests/footer.spec.ts": ["src/components/global/Footer.astro"],
  "tests/hero.spec.ts": [
    "src/components/sections/Hero.astro",
    "src/pages/style-guide.astro",
  ],
  "tests/invitation.spec.ts": [
    "src/components/sections/Invitation.astro",
    "src/scripts/draw-path.ts",
    "src/scripts/highlight-text.ts",
  ],
  "tests/music.spec.ts": [
    "src/scripts/spotify-player.ts",
    "src/components/global/Nav.astro",
    "src/components/global/Preloader.astro",
    "src/components/sections/Playlist.astro",
  ],
  "tests/nav-hover.spec.ts": [
    "src/components/global/Nav.astro",
    "src/components/global/NavLink.astro",
  ],
  "tests/nav-scrollbar.spec.ts": [
    "src/components/global/Nav.astro",
    "src/components/global/NavLink.astro",
  ],
  "tests/nav.spec.ts": [
    "src/components/global/Nav.astro",
    "src/scripts/spotify-player.ts",
    "src/components/global/NavLink.astro",
  ],
  "tests/parallax.spec.ts": ["src/scripts/scroll.ts"],
  "tests/playlist.spec.ts": [
    "src/components/sections/Playlist.astro",
    "src/scripts/spotify-player.ts",
    "src/actions/",
    "src/lib/guest.ts",
  ],
  "tests/pre-wedding.spec.ts": ["src/components/sections/PreWedding.astro"],
  "tests/preloader.spec.ts": [
    "src/components/global/Preloader.astro",
    "src/scripts/spotify-player.ts",
    "src/lib/guest.ts",
    "src/scripts/turnstile.ts",
  ],
  "tests/ribbons.spec.ts": [
    "src/components/sections/Ribbons.astro",
    "src/components/interactive/Marquee.astro",
  ],
  "tests/rsvp-ticket.spec.ts": [
    "src/components/sections/RsvpTicketPrinter.astro",
    "src/lib/rsvp/",
  ],
  "tests/rsvp-paths.spec.ts": [
    "src/components/sections/Rsvp.astro",
    "src/components/sections/RsvpTicketPrinter.astro",
    "src/actions/",
    "src/lib/rsvp/",
  ],
  "tests/rsvp.spec.ts": [
    "src/components/sections/Rsvp.astro",
    "src/actions/",
    "src/lib/rsvp/",
  ],
  "tests/scroll.spec.ts": [
    "src/scripts/scroll.ts",
    "src/components/global/SkipLink.astro",
  ],
  "tests/smoke.spec.ts": ["*"],
  "tests/stamp.spec.ts": ["src/components/media/Stamp.astro"],
  "tests/stay.spec.ts": [
    "src/components/sections/Stay.astro",
    "src/scripts/stay-compass.ts",
  ],
  "tests/tokens.spec.ts": ["*"],
  "tests/wedding.spec.ts": [
    "src/components/sections/Wedding.astro",
    "src/components/interactive/Tabs.astro",
    "src/scripts/tab-system.ts",
  ],
  "tests/with-love-uploads.spec.ts": [
    "src/components/sections/WithLoveUpload.astro",
    "src/actions/",
    "src/lib/with-love/",
    "src/scripts/with-love/",
  ],
  "tests/with-love.spec.ts": [
    "src/components/sections/WithLove.astro",
    "src/actions/",
    "src/lib/with-love/",
    "src/scripts/with-love/",
  ],
};

const EXTENSIONS = [".astro", ".ts", ".js", ".mjs", ".css", ".scss", ".json"];
const IMPORT_RE =
  /(?:^|[;{}\n])\s*(?:import\s+(?:type\s+)?(?:[^"'();]+?\s+from\s+)?|export\s+[^"'();]+?\s+from\s+|import\s*\(\s*)["']([^"']+)["']/gm;
const GLOB_RE = /import\.meta\.glob\s*(?:<[^()\n]*>)?\s*\(([\s\S]*?)\)/g;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?["']([^"']+)["']/g;
const slash = (value) => value.split(sep).join("/");
const isSpec = (file) => /^tests\/[^/]+\.spec\.ts$/.test(file);
const isSourceUnit = (file) => /^src\/.*\.test\.(?:mjs|ts)$/.test(file);
function sourceFiles(root) {
  const result = [];
  function walk(dir) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (EXTENSIONS.includes(extname(file))) result.push(resolve(file));
    }
  }
  walk(join(root, "src"));
  return result;
}
function aliasFor(root) {
  try {
    const paths =
      JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"))
        .compilerOptions?.paths ?? {};
    const entry = Object.entries(paths).find(([key]) => key.endsWith("/*"));
    return entry
      ? {
          prefix: entry[0].slice(0, -1),
          target: entry[1][0].replace(/^\.\//, "").replace(/\*$/, ""),
        }
      : null;
  } catch {
    return null;
  }
}
function resolveImport(specifier, importer, root, alias) {
  let base;
  if (specifier.startsWith("@/") && alias)
    base = join(root, alias.target, specifier.slice(alias.prefix.length));
  else if (specifier.startsWith("/")) base = join(root, specifier.slice(1));
  else if (specifier.startsWith("."))
    base = resolve(dirname(importer), specifier);
  else return null;
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => `${base}${ext}`),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find(existsSync)
    ? resolve(candidates.find(existsSync))
    : undefined;
}
function literal(value) {
  const text = value.trim();
  if (!/^['"]/.test(text)) return null;
  const quote = text[0];
  const end = text.indexOf(quote, 1);
  return end > 0 && text.slice(end + 1).trim() === ""
    ? text.slice(1, end)
    : null;
}
function buildGraph(root) {
  const reverse = new Map();
  const unresolved = new Set();
  const globTargets = new Set();
  const files = sourceFiles(root);
  const alias = aliasFor(root);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const dynamic of source.matchAll(/\bimport\s*\(([\s\S]*?)\)/g))
      if (!literal(dynamic[1])) unresolved.add(file);
    for (const match of source.matchAll(GLOB_RE)) {
      unresolved.add(file);
      const arg = match[1].trim();
      const pattern = literal(arg.split(",", 1)[0]);
      const wildcard = pattern?.search(/[＊*?\[{]/) ?? -1;
      const target = pattern
        ? pattern
            .slice(0, wildcard === -1 ? pattern.length : wildcard)
            .replace(/^\//, "")
        : "src";
      globTargets.add(
        resolve(pattern?.startsWith("/") ? root : dirname(file), target || "."),
      );
    }
    const imports = [...source.matchAll(IMPORT_RE)].map((match) => match[1]);
    if (extname(file) === ".css" || extname(file) === ".astro")
      imports.push(
        ...[...source.matchAll(CSS_IMPORT_RE)].map((match) => match[1]),
      );
    for (const specifier of new Set(imports)) {
      const target = resolveImport(specifier, file, root, alias);
      if (target) {
        const parents = reverse.get(target) ?? [];
        parents.push(file);
        reverse.set(target, parents);
      } else if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier.startsWith("@/")
      )
        unresolved.add(file);
    }
  }
  return { reverse, unresolved, globTargets };
}
function matches(path, source) {
  return (
    source === "*" ||
    (source.endsWith("/") ? path.startsWith(source) : path === source)
  );
}
function importerClosure(file, graph, root) {
  const start = resolve(root, file);
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length) {
    for (const parent of graph.reverse.get(queue.shift()) ?? []) {
      if (!seen.has(parent)) {
        seen.add(parent);
        queue.push(parent);
      }
    }
  }
  return seen;
}
function walkImporters(file, graph, root, specSources) {
  const seen = new Set();
  const selected = new Set();
  let broad = false;

  // Each importer branch stops at its owning spec source. Reaching an unowned
  // layout or page means the changed module is shared by the whole runtime.
  function visit(current) {
    if (seen.has(current) || broad) return;
    seen.add(current);
    const relativePath = slash(relative(root, current));
    const owners = Object.entries(specSources)
      .filter(([, sources]) =>
        sources.some(
          (source) => source !== "*" && matches(relativePath, source),
        ),
      )
      .map(([spec]) => spec);
    if (owners.length > 0) {
      owners.forEach((spec) => selected.add(spec));
      return;
    }
    if (
      relativePath.startsWith("src/layouts/") ||
      relativePath.startsWith("src/pages/")
    ) {
      broad = true;
      return;
    }
    for (const parent of graph.reverse.get(current) ?? []) visit(parent);
  }

  visit(resolve(root, file));
  return { seen, selected, broad };
}
function diskSpecs(root) {
  return readdirSync(join(root, "tests"), { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".spec.ts"))
    .map((e) => `tests/${e.name}`);
}
export function checkSpecSources({
  root = process.cwd(),
  specSources = SPEC_SOURCES,
} = {}) {
  const disk = new Set(diskSpecs(root));
  const errors = [];
  for (const spec of disk)
    if (!(spec in specSources))
      errors.push(`${spec} is missing from SPEC_SOURCES`);
  for (const [spec, sources] of Object.entries(specSources)) {
    if (!disk.has(spec))
      errors.push(`SPEC_SOURCES lists ${spec}, which does not exist`);
    for (const source of sources)
      if (source !== "*" && !existsSync(join(root, source)))
        errors.push(`${spec} names missing source ${source}`);
  }
  return { ok: errors.length === 0, errors };
}
export function selectSpecs(
  paths,
  { root = process.cwd(), specSources = SPEC_SOURCES } = {},
) {
  const files = paths.map((file) => slash(file.trim())).filter(Boolean);
  const classification = classifyPaths(files);
  if (!classification.runtime)
    return {
      mode: "none",
      specs: [],
      reasons: classification.reasons.map((message) => ({ message })),
    };
  const graph = buildGraph(root);
  let broad = false;
  const selected = new Set();
  const narrow = [];
  for (const file of files) {
    if (isSpec(file)) {
      selected.add(file);
      continue;
    }
    if (!file.startsWith("src/")) {
      broad = true;
      continue;
    }
    if (
      BROAD.has(file) ||
      BROAD_PREFIXES.some((prefix) => file.startsWith(prefix))
    ) {
      broad = true;
      continue;
    }
    const absolute = resolve(root, file);
    const walked = walkImporters(file, graph, root, specSources);
    const reached = importerClosure(file, graph, root);
    if (walked.broad) {
      broad = true;
      continue;
    }
    if (
      graph.unresolved.has(absolute) ||
      [...graph.globTargets].some((target) =>
        absolute.startsWith(`${target}${sep}`),
      )
    ) {
      broad = true;
      continue;
    }
    const fanIn = [...reached].filter((candidate) => {
      const rel = slash(relative(root, candidate));
      return (
        rel.startsWith("src/components/sections/") ||
        rel.startsWith("src/components/global/")
      );
    });
    if (fanIn.length >= FAN_IN_THRESHOLD) {
      broad = true;
      continue;
    }
    const matching = [...walked.selected];
    if (matching.length === 0 && !isSourceUnit(file)) broad = true;
    else narrow.push(...matching);
  }
  if (broad)
    return { mode: "broad", specs: [], reasons: [{ broad: true, files }] };
  for (const spec of narrow) selected.add(spec);
  if (narrow.length > 0)
    for (const [spec, sources] of Object.entries(specSources))
      if (sources.includes("*")) selected.add(spec);
  return {
    mode: selected.size ? "specs" : "none",
    specs: [...selected].sort(),
    reasons: [],
  };
}
async function readInput() {
  let input = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) input += chunk;
  return input.split(/\r?\n/);
}
async function main() {
  if (process.argv.includes("--check")) {
    const result = checkSpecSources();
    for (const error of result.errors) console.error(error);
    if (!result.ok) process.exitCode = 1;
    else console.log("SPEC_SOURCES is complete");
    return;
  }
  const result = selectSpecs(await readInput());
  if (process.argv.includes("--json")) console.log(JSON.stringify(result));
  else {
    console.log(
      result.mode === "specs" ? result.specs.join("\n") || "none" : result.mode,
    );
    if (result.mode === "broad")
      console.error("broad: changed runtime file requires the full suite");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
