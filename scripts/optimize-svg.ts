/**
 * optimize-svg.ts
 *
 * Runs SVGO on all SVGs in svg/ to:
 * - Clean up metadata, comments, editor cruft
 * - Remove fixed dimensions (size controlled via React props)
 * - Optimise paths
 *
 * IMPORTANT: Unlike comete-icons, illustrations are multicolored.
 * We do NOT replace colors with currentColor. All original colors
 * are preserved to maintain the visual richness of illustrations.
 *
 * Usage:  tsx scripts/optimize-svg.ts
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Config, optimize } from "svgo";

const SVG_DIR = join(import.meta.dirname!, "..", "svg");

/**
 * SVGO config for illustrations.
 * Preserves all colors — only removes metadata and optimises paths.
 */
const config: Config = {
  multipass: true,
  plugins: [
    {
      name: "preset-default",
      params: {
        overrides: {
          // Keep viewBox for scaling
          removeViewBox: false,
          // Keep IDs — illustrations may reference them internally
          cleanupIds: false,
        },
      },
    },
    // Remove fixed dimensions (we control size via React props)
    "removeDimensions",
    // Remove unnecessary xmlns:xlink
    {
      name: "removeAttrs",
      params: {
        attrs: ["svg:xmlns:xlink"],
      },
    },
  ],
};

function main() {
  let files: string[];
  try {
    files = readdirSync(SVG_DIR).filter((f) => f.endsWith(".svg"));
  } catch {
    console.warn("⚠️  svg/ directory not found. Run figma:sync first.");
    return;
  }

  let total = 0;
  for (const file of files) {
    const filepath = join(SVG_DIR, file);
    const raw = readFileSync(filepath, "utf-8");

    const result = optimize(raw, {
      ...config,
      path: filepath,
    });

    writeFileSync(filepath, result.data, "utf-8");
    total++;
  }

  console.log(`✅ Optimised ${total} illustration SVGs`);
}

main();
