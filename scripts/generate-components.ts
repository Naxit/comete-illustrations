/**
 * generate-components.ts
 *
 * Reads optimised SVGs from svg/ and generates:
 *   - src/illustrations/{IllustrationName}.tsx  (one per illustration)
 *   - src/types.ts
 *   - src/index.ts                              (barrel export)
 *   - src/registry.ts                           (name → component map)
 *
 * Unlike comete-icons, illustrations:
 * - Have no variants (outlined/filled/duotone)
 * - Have no spacing variants (default/none)
 * - Preserve original multicolor fills
 * - Accept width/height or a single size prop
 * - Support an optional category for organisation
 *
 * Usage:  tsx scripts/generate-components.ts
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

const ROOT = join(import.meta.dirname!, "..");
const SVG_DIR = join(ROOT, "svg");
const SRC_DIR = join(ROOT, "src");
const ILLUS_DIR = join(SRC_DIR, "illustrations");
const MANIFEST_PATH = join(SVG_DIR, ".manifest.json");

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

/** Sort names using natural/locale sort to match Biome's import ordering */
function sortNames(names: string[]): string[] {
  return [...names].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Extract SVG inner content (everything between <svg> and </svg>) */
function extractSvgInner(svg: string): string {
  const clean = svg.replace(/<\?xml[^?]*\?>\s*/g, "");
  const match = clean.match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!match) return "";
  return match[1].trim();
}

/** Extract viewBox from SVG */
function extractViewBox(svg: string): string {
  const match = svg.match(/viewBox="([^"]+)"/);
  return match?.[1] ?? "0 0 200 200";
}

/** Convert a CSS property name to its camelCase JSX equivalent */
function cssPropToJsx(prop: string): string {
  return prop.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** Convert inline style="..." strings to JSX style={{ ... }} objects */
function convertInlineStyles(content: string): string {
  return content.replace(/style="([^"]+)"/g, (_match, css: string) => {
    const pairs = css
      .split(";")
      .filter((s: string) => s.trim())
      .map((s: string) => {
        const [prop, ...rest] = s.split(":");
        const value = rest.join(":").trim();
        return `${cssPropToJsx(prop)}: "${value}"`;
      })
      .join(", ");
    return `style={{${pairs}}}`;
  });
}

/** Convert SVG attributes to JSX (kebab-case → camelCase) */
function svgToJsx(svgContent: string): string {
  return convertInlineStyles(svgContent)
    .replace(/clip-rule/g, "clipRule")
    .replace(/fill-rule/g, "fillRule")
    .replace(/fill-opacity/g, "fillOpacity")
    .replace(/stroke-width/g, "strokeWidth")
    .replace(/stroke-linecap/g, "strokeLinecap")
    .replace(/stroke-linejoin/g, "strokeLinejoin")
    .replace(/stroke-dasharray/g, "strokeDasharray")
    .replace(/stroke-dashoffset/g, "strokeDashoffset")
    .replace(/stroke-miterlimit/g, "strokeMiterlimit")
    .replace(/stroke-opacity/g, "strokeOpacity")
    .replace(/stop-color/g, "stopColor")
    .replace(/stop-opacity/g, "stopOpacity")
    .replace(/class="/g, 'className="')
    .replace(/xmlns:xlink="[^"]*"/g, "");
}

// ─── Build illustration data ──────────────────────────────────────────────

interface IllustrationData {
  name: string;
  category: string | null;
  inner: string;
  viewBox: string;
}

function buildIllustrationList(): IllustrationData[] {
  const results: IllustrationData[] = [];

  // Load manifest for category metadata
  let manifest: Manifest | null = null;
  if (existsSync(MANIFEST_PATH)) {
    try {
      manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8")) as Manifest;
    } catch {
      // No manifest, categories will be null
    }
  }

  let files: string[];
  try {
    files = readdirSync(SVG_DIR).filter((f) => f.endsWith(".svg"));
  } catch {
    console.warn("⚠️  svg/ directory not found. Run figma:sync first.");
    return [];
  }

  for (const file of files) {
    const name = basename(file, ".svg");
    const svg = readFileSync(join(SVG_DIR, file), "utf-8");
    const inner = extractSvgInner(svg);
    const viewBox = extractViewBox(svg);

    const manifestKey = `${name}.svg`;
    const category = manifest?.illustrations[manifestKey]?.category ?? null;

    results.push({
      name,
      category,
      inner: svgToJsx(inner),
      viewBox,
    });
  }

  return results;
}

// ─── Generate types.ts ────────────────────────────────────────────────────

function generateTypes(
  illustrationNames: string[],
  categories: string[],
): string {
  const sorted = sortNames(illustrationNames);
  const sortedCategories = sortNames(categories);

  return `import type { SVGAttributes } from "react";

/** Union of every available illustration name (auto-generated from SVG sources). */
export type IllustrationName =
${sorted.map((n) => `  | "${n}"`).join("\n")};

/** Available illustration categories. */
export type IllustrationCategory =
${sortedCategories.length > 0 ? sortedCategories.map((c) => `  | "${c}"`).join("\n") : "  | never"};

export interface IllustrationProps extends Omit<SVGAttributes<SVGSVGElement>, "width" | "height"> {
  /**
   * Rendered width in pixels. Defaults to the illustration's natural width.
   * If only width is set, height scales proportionally.
   */
  width?: number | string;
  /**
   * Rendered height in pixels. Defaults to the illustration's natural height.
   * If only height is set, width scales proportionally.
   */
  height?: number | string;
  /** Additional CSS class. */
  className?: string;
  /** Accessible label. If omitted, illustration is decorative (aria-hidden). */
  "aria-label"?: string;
}
`;
}

// ─── Generate component ───────────────────────────────────────────────────

function generateComponent(illus: IllustrationData): string {
  return `import type { IllustrationProps } from "../types";

const VIEW_BOX = "${illus.viewBox}";

export function ${illus.name}({
  width,
  height,
  className,
  "aria-label": ariaLabel,
  ...props
}: IllustrationProps) {
  const isDecorative = !ariaLabel;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={VIEW_BOX}
      width={width}
      height={height}
      className={className}
      role={isDecorative ? "presentation" : "img"}
      aria-hidden={isDecorative ? "true" : undefined}
      aria-label={ariaLabel}
      {...props}
    >
      ${illus.inner}
    </svg>
  );
}

${illus.name}.displayName = "${illus.name}";
`;
}

// ─── Generate registry ────────────────────────────────────────────────────

function generateRegistry(illustrations: IllustrationData[]): string {
  const sorted = sortNames(illustrations.map((i) => i.name));
  const lines = [
    "/* Auto-generated — do not edit manually */",
    'import type { ComponentType } from "react";',
    'import type { IllustrationName, IllustrationProps } from "./types";',
    "",
  ];

  for (const name of sorted) {
    lines.push(`import { ${name} } from "./illustrations/${name}";`);
  }

  lines.push("");
  lines.push("/** Maps every illustration name to its React component. */");
  lines.push(
    "export const illustrationRegistry: Record<IllustrationName, ComponentType<IllustrationProps>> = {",
  );
  for (const name of sorted) {
    lines.push(`  ${name},`);
  }
  lines.push("};");

  // Category map
  const categoryMap = new Map<string, string[]>();
  for (const illus of illustrations) {
    const cat = illus.category ?? "uncategorized";
    if (!categoryMap.has(cat)) categoryMap.set(cat, []);
    categoryMap.get(cat)!.push(illus.name);
  }

  lines.push("");
  lines.push("/** Maps categories to their illustration names. */");
  lines.push(
    "export const illustrationsByCategory: Record<string, IllustrationName[]> = {",
  );
  for (const [cat, names] of [...categoryMap.entries()].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    lines.push(
      `  "${cat}": [${sortNames(names)
        .map((n) => `"${n}"`)
        .join(", ")}],`,
    );
  }
  lines.push("};");
  lines.push("");

  return lines.join("\n");
}

// ─── Generate barrel index ────────────────────────────────────────────────

function generateIndex(illustrationNames: string[]): string {
  const lines = [
    "/* Auto-generated — do not edit manually */",
    "",
    "// Illustrations",
  ];

  for (const name of sortNames(illustrationNames)) {
    lines.push(`export { ${name} } from "./illustrations/${name}";`);
  }

  lines.push("");
  lines.push("// Types");
  lines.push(
    'export type { IllustrationProps, IllustrationName, IllustrationCategory } from "./types";',
  );
  lines.push("");
  lines.push("// Registry");
  lines.push(
    'export { illustrationRegistry, illustrationsByCategory } from "./registry";',
  );
  lines.push("");

  return lines.join("\n");
}

// ─── Main ──────────────────────────────────────────────────────────────────

function main() {
  console.log("🔨 Building illustration map from SVGs…");
  const illustrations = buildIllustrationList();
  console.log(`   Found ${illustrations.length} illustrations`);

  if (illustrations.length === 0) {
    console.log("⚠️  No SVGs found. Run figma:sync first.");
    return;
  }

  // Ensure dirs
  if (!existsSync(ILLUS_DIR)) mkdirSync(ILLUS_DIR, { recursive: true });

  // Generate components
  const names: string[] = [];
  for (const illus of illustrations) {
    writeFileSync(
      join(ILLUS_DIR, `${illus.name}.tsx`),
      generateComponent(illus),
      "utf-8",
    );
    names.push(illus.name);
  }
  console.log(`   ✓ ${names.length} illustration components`);

  // Collect unique categories
  const categories = [
    ...new Set(
      illustrations
        .map((i) => i.category)
        .filter((c): c is string => c !== null),
    ),
  ];

  // Generate types
  writeFileSync(
    join(SRC_DIR, "types.ts"),
    generateTypes(names, categories),
    "utf-8",
  );
  console.log("   ✓ types.ts");

  // Generate registry
  writeFileSync(
    join(SRC_DIR, "registry.ts"),
    generateRegistry(illustrations),
    "utf-8",
  );
  console.log("   ✓ registry.ts");

  // Generate barrel
  writeFileSync(join(SRC_DIR, "index.ts"), generateIndex(names), "utf-8");
  console.log("   ✓ index.ts");

  console.log(`\n✅ Generated ${names.length} React illustration components`);
}

main();
