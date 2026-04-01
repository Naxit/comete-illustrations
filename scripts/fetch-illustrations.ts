/**
 * fetch-illustrations.ts
 *
 * Fetches all illustration SVGs from the Figma file via the REST API.
 * Organises them into svg/{IllustrationName}.svg
 *
 * Illustrations live in a dedicated Figma frame, separate from icons.
 * Unlike icons, illustrations have no variant/spacing properties —
 * each frame child is a single illustration.
 *
 * Reads FIGMA_TOKEN from .env or environment variable.
 *
 * Usage:  pnpm figma:sync
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

// ─── .env loader (zero-dep) ────────────────────────────────────────────────
const ROOT = join(import.meta.dirname!, "..");
const envPath = join(ROOT, ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = (match[2] ?? "").replace(/^["']|["']$/g, "");
    }
  }
}

// ─── Config ────────────────────────────────────────────────────────────────
const FIGMA_TOKEN = process.env.FIGMA_TOKEN;
if (!FIGMA_TOKEN) {
  console.error(
    "❌ Missing FIGMA_TOKEN. Set it in .env or pass via env variable.",
  );
  process.exit(1);
}

// NOTE: Same Figma file as comete-icons, different frame
const FILE_KEY = "3rYV3P1VzRh0q22HNhgCZv";
const FRAME_NODE_ID = "723:3562"; // Illustrations frame
const SVG_DIR = join(ROOT, "svg");
const MANIFEST_PATH = join(SVG_DIR, ".manifest.json");
const BATCH_SIZE = 100;
const DEBUG = process.argv.includes("--debug");
const FORCE = process.argv.includes("--force");

// ─── Types ─────────────────────────────────────────────────────────────────
interface FigmaNode {
  id: string;
  name: string;
  type: string;
  children?: FigmaNode[];
}

interface IllustrationEntry {
  nodeId: string;
  name: string;
  /** Optional category extracted from "Category/Name" naming convention */
  category: string | null;
}

interface ManifestEntry {
  nodeId: string;
  name: string;
  category: string | null;
  hash: string;
}

interface Manifest {
  lastModified: string;
  generatedAt: string;
  illustrations: Record<string, ManifestEntry>;
}

function svgHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function loadManifest(): Manifest | null {
  if (!existsSync(MANIFEST_PATH)) return null;
  try {
    return JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
  } catch {
    return null;
  }
}

function saveManifest(manifest: Manifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), "utf-8");
}

// ─── Helpers ───────────────────────────────────────────────────────────────
async function figmaGet<T>(path: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(`https://api.figma.com/v1${path}`, {
      headers: { "X-Figma-Token": FIGMA_TOKEN! },
    });
    if (res.status === 429 && attempt < retries) {
      const wait = 2 ** (attempt + 1) * 15_000;
      console.warn(
        `⏳ Rate limited, waiting ${Math.round(wait / 1000)}s before retry…`,
      );
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) {
      throw new Error(`Figma API ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error("Figma API: max retries exceeded");
}

/**
 * Convert a Figma frame name to a PascalCase component name.
 *
 * Figma naming convention: "Illustrations / SomeName" or "Illustrations / Connexion error"
 * - Strips the "Illustrations / " prefix
 * - Preserves existing PascalCase (e.g. "AddDocuments" stays "AddDocuments")
 * - Converts space-separated words to PascalCase (e.g. "Connexion error" → "ConnexionError")
 */
function toPascalCase(name: string): string {
  // Strip "Illustrations / " prefix (case-insensitive, flexible spacing)
  const stripped = name.replace(/^illustrations\s*\/\s*/i, "").trim();
  // If already a single PascalCase word (no spaces), keep as-is
  if (!stripped.includes(" ")) return stripped;
  // Multi-word: capitalize first letter of each word, preserve rest of casing
  return stripped
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/**
 * Extract category from the illustration name.
 *
 * Current Figma convention: "Illustrations / Name" — the "Illustrations"
 * prefix is structural, not a meaningful category. Returns null.
 *
 * If the naming convention evolves to "Illustrations / Category / Name",
 * this function will extract the middle segment as the category.
 */
function extractCategory(name: string): string | null {
  const parts = name.split("/").map((p) => p.trim());
  // "Illustrations / Name" → 2 parts → no meaningful category
  if (parts.length <= 2) return null;
  // "Illustrations / Category / Name" → extract Category
  return parts[1].toLowerCase().replace(/\s+/g, "-");
}

/**
 * Node types that represent actual illustration components in Figma.
 * COMPONENT_SET contains variants, COMPONENT is a single component,
 * SYMBOL is used in the REST API response for both.
 */
const ILLUSTRATION_NODE_TYPES = new Set([
  "COMPONENT",
  "COMPONENT_SET",
  "SYMBOL",
  "FRAME",
]);

/**
 * Collects illustration entries from the Figma frame.
 *
 * Figma structure:
 *   Frame "Illustrations" (723:3562)
 *     └─ Frame "illustrations" (723:3563)  ← container sub-frame
 *         ├─ Symbol "Illustrations / AddDocuments"
 *         ├─ Symbol "Illustrations / AppDisabled"
 *         └─ ...
 *
 * Handles both flat (illustrations at root level) and nested (intermediate frame) structures.
 * Skips hidden nodes and non-illustration elements (instances, images, etc.).
 */
function collectIllustrations(node: FigmaNode): IllustrationEntry[] {
  const results: IllustrationEntry[] = [];

  /** Process a single node as a potential illustration */
  function processNode(child: FigmaNode): void {
    // Skip non-illustration node types (instances, rectangles, etc.)
    if (!ILLUSTRATION_NODE_TYPES.has(child.type)) {
      if (DEBUG) {
        console.log(`  ⏭️  Skipping [${child.type}] "${child.name}" id=${child.id}`);
      }
      return;
    }

    // Skip nodes whose name doesn't match the "Illustrations / ..." pattern
    // (safety check to avoid picking up unrelated frames)
    const isIllustration = /^illustrations\s*\//i.test(child.name);
    if (!isIllustration) {
      // Could be an intermediate container frame — recurse into it
      if (child.children && child.children.length > 0) {
        if (DEBUG) {
          console.log(
            `  📂 Entering sub-frame [${child.type}] "${child.name}" id=${child.id} — ${child.children.length} children`,
          );
        }
        for (const grandchild of child.children) {
          processNode(grandchild);
        }
      }
      return;
    }

    if (DEBUG) {
      console.log(
        `  ✓ [${child.type}] "${child.name}" id=${child.id}`,
      );
    }

    const name = toPascalCase(child.name);
    const category = extractCategory(child.name);

    results.push({ nodeId: child.id, name, category });
  }

  if (node.children) {
    for (const child of node.children) {
      processNode(child);
    }
  }

  return results;
}

async function downloadSvg(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status}`);
  return res.text();
}

// ─── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log("📡 Fetching Figma file tree…");

  const fileMeta = await figmaGet<{ lastModified: string }>(
    `/files/${FILE_KEY}?depth=1`,
  );
  const fileLastModified = fileMeta.lastModified;
  console.log(`📅 Figma lastModified: ${fileLastModified}`);

  const prevManifest = loadManifest();
  if (
    !FORCE &&
    prevManifest &&
    prevManifest.lastModified === fileLastModified
  ) {
    console.log(
      "✅ Aucun changement détecté dans le fichier Figma depuis le dernier sync.",
    );
    console.log(
      "   Utilisez --force pour forcer un re-téléchargement complet.",
    );
    return;
  }

  const data = await figmaGet<{
    nodes: Record<string, { document: FigmaNode }>;
  }>(`/files/${FILE_KEY}/nodes?ids=${FRAME_NODE_ID}&depth=10`);

  const rootNode =
    data.nodes[FRAME_NODE_ID]?.document ??
    data.nodes[Object.keys(data.nodes)[0]]?.document;

  if (!rootNode) {
    console.error("❌ Could not find node", FRAME_NODE_ID);
    console.error("   Available keys:", Object.keys(data.nodes));
    process.exit(1);
  }

  console.log(
    `📂 Root: "${rootNode.name}" [${rootNode.type}] — ${rootNode.children?.length ?? 0} children`,
  );

  if (DEBUG) {
    console.log("\n── Tree structure ──");
    function printTree(n: FigmaNode, d = 0, max = 3) {
      if (d > max) return;
      console.log(
        `${"  ".repeat(d)}[${n.type}] "${n.name}" (${n.children?.length ?? 0} children) id=${n.id}`,
      );
      if (n.children) {
        for (const c of n.children) printTree(c, d + 1, max);
      }
    }
    printTree(rootNode);
    console.log("── End tree ──\n");
  }

  const illustrations = collectIllustrations(rootNode);
  console.log(`🔍 Found ${illustrations.length} illustrations`);

  if (illustrations.length === 0) {
    console.log(
      "\n⚠️  No illustrations found. Run with --debug to inspect the tree:",
    );
    console.log("   pnpm figma:sync -- --debug");
    return;
  }

  // Build current key set
  const currentKeys = new Set<string>();
  const entryByKey = new Map<string, IllustrationEntry>();
  for (const illus of illustrations) {
    const key = `${illus.name}.svg`;
    currentKeys.add(key);
    entryByKey.set(key, illus);
  }

  mkdirSync(SVG_DIR, { recursive: true });

  // Determine which illustrations to fetch
  let toFetch: IllustrationEntry[];
  let removedKeys: string[] = [];

  if (FORCE || !prevManifest) {
    if (existsSync(SVG_DIR)) {
      rmSync(SVG_DIR, { recursive: true });
      console.log("🧹 Cleaned svg/ directory");
    }
    mkdirSync(SVG_DIR, { recursive: true });
    toFetch = illustrations;
    console.log(
      FORCE
        ? "🔄 Mode --force : re-téléchargement complet"
        : "🆕 Premier sync : téléchargement complet",
    );
  } else {
    const prevKeys = new Set(Object.keys(prevManifest.illustrations));
    const newKeys = [...currentKeys].filter((k) => !prevKeys.has(k));
    removedKeys = [...prevKeys].filter((k) => !currentKeys.has(k));
    const changedKeys = [...currentKeys].filter((k) => {
      if (!prevKeys.has(k)) return false;
      const prev = prevManifest.illustrations[k];
      const curr = entryByKey.get(k)!;
      return prev.nodeId !== curr.nodeId;
    });

    toFetch = [...newKeys, ...changedKeys]
      .map((k) => entryByKey.get(k)!)
      .filter(Boolean);

    for (const key of removedKeys) {
      const filepath = join(SVG_DIR, key);
      if (existsSync(filepath)) unlinkSync(filepath);
    }

    console.log(
      `📊 Incrémental : ${newKeys.length} nouvelles, ${changedKeys.length} modifiées, ${removedKeys.length} supprimées`,
    );

    if (toFetch.length === 0 && removedKeys.length === 0) {
      console.log("✅ Aucune illustration à mettre à jour.");
      saveManifest({
        ...prevManifest,
        lastModified: fileLastModified,
        generatedAt: new Date().toISOString(),
      });
      return;
    }
  }

  // Batch export SVGs
  if (toFetch.length > 0) {
    const allNodeIds = toFetch.map((i) => i.nodeId);
    const urlMap: Record<string, string> = {};

    for (let i = 0; i < allNodeIds.length; i += BATCH_SIZE) {
      const batch = allNodeIds.slice(i, i + BATCH_SIZE);
      console.log(
        `📦 Requesting SVG export batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allNodeIds.length / BATCH_SIZE)}…`,
      );
      const result = await figmaGet<{ images: Record<string, string> }>(
        `/images/${FILE_KEY}?ids=${batch.join(",")}&format=svg`,
      );
      Object.assign(urlMap, result.images);
    }

    let saved = 0;
    let errors = 0;
    const CONCURRENCY = 20;
    const entries = toFetch.map((illus) => ({
      illus,
      url: urlMap[illus.nodeId],
    }));

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const chunk = entries.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map(async ({ illus, url }) => {
          if (!url) {
            console.warn(`⚠️  No URL for ${illus.name}`);
            errors++;
            return;
          }
          try {
            const svg = await downloadSvg(url);
            const filepath = join(SVG_DIR, `${illus.name}.svg`);
            writeFileSync(filepath, svg, "utf-8");
            saved++;
          } catch (err) {
            console.warn(`⚠️  Failed to download ${illus.name}: ${err}`);
            errors++;
          }
        }),
      );
    }

    console.log(`\n✅ Saved ${saved} SVGs (${errors} errors)`);
  }

  if (removedKeys.length > 0) {
    console.log(`🗑️  Supprimé ${removedKeys.length} SVGs obsolètes`);
  }

  // Build and save manifest
  const manifestIllustrations: Record<string, ManifestEntry> = {};
  for (const illus of illustrations) {
    const key = `${illus.name}.svg`;
    const filepath = join(SVG_DIR, key);
    let hash = "";
    if (existsSync(filepath)) {
      hash = svgHash(readFileSync(filepath, "utf-8"));
    }
    manifestIllustrations[key] = {
      nodeId: illus.nodeId,
      name: illus.name,
      category: illus.category,
      hash,
    };
  }

  saveManifest({
    lastModified: fileLastModified,
    generatedAt: new Date().toISOString(),
    illustrations: manifestIllustrations,
  });
  console.log(
    `📋 Manifeste sauvegardé (${Object.keys(manifestIllustrations).length} entrées)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
