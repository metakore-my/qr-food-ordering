// scripts/optimize-backgrounds.mjs
// One-shot: optimize downloaded background source images into ~1920px WebP.
// Usage: node scripts/optimize-backgrounds.mjs <srcRootDir>
//   expects <srcRootDir>/<cuisine>/<anything>.{jpg,jpeg,png,webp} for each cuisine.
// Writes public/images/backgrounds/<cuisine>/0<n>.webp (first 5, sorted).
import sharp from "sharp";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

const CUISINES = ["thai", "malaysian", "singaporean", "vietnamese"];
const OUT_ROOT = path.resolve("public/images/backgrounds");
const MAX_WIDTH = 1920;
const QUALITY = 80;
const HARD_CEILING_BYTES = 300 * 1024; // 300 KB

const srcRoot = process.argv[2];
if (!srcRoot) {
  console.error("Usage: node scripts/optimize-backgrounds.mjs <srcRootDir>");
  process.exit(1);
}

let failed = false;
for (const cuisine of CUISINES) {
  const srcDir = path.join(srcRoot, cuisine);
  const outDir = path.join(OUT_ROOT, cuisine);
  await mkdir(outDir, { recursive: true });

  let files;
  try {
    files = (await readdir(srcDir))
      .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
      .sort();
  } catch {
    console.error(`MISSING source dir: ${srcDir}`);
    failed = true;
    continue;
  }
  if (files.length < 5) {
    console.error(`MISSING images for ${cuisine}: found ${files.length}, need 5`);
    failed = true;
    continue;
  }

  for (let i = 0; i < 5; i++) {
    const out = path.join(outDir, `0${i + 1}.webp`);
    const src = path.join(srcDir, files[i]);

    // Escalating compression ladder: drop quality, then width, until the file
    // is under the ceiling. The background is veiled + blurred, so the lower
    // quality on a detail-heavy photo is imperceptible. The first step is the
    // normal case; later steps only kick in for unusually detailed images.
    const ladder = [
      [MAX_WIDTH, QUALITY], // 1920 q80 — normal
      [MAX_WIDTH, 68],
      [MAX_WIDTH, 58],
      [1600, 60],
      [1600, 50],
      [1280, 50],
    ];
    let size = Infinity;
    let used = ladder[0];
    for (const [width, quality] of ladder) {
      await sharp(src)
        .rotate() // honor EXIF orientation
        .resize({ width, withoutEnlargement: true })
        .webp({ quality })
        .toFile(out);
      ({ size } = await stat(out));
      used = [width, quality];
      if (size <= HARD_CEILING_BYTES) break;
    }
    const kb = Math.round(size / 1024);
    const flag = size > HARD_CEILING_BYTES ? " ⚠ OVER 300KB" : "";
    const tuned = used[1] !== QUALITY || used[0] !== MAX_WIDTH ? ` (w${used[0]} q${used[1]})` : "";
    console.log(`${cuisine}/0${i + 1}.webp  ${kb} KB${tuned}${flag}`);
    if (size > HARD_CEILING_BYTES) failed = true;
  }
}

if (failed) {
  console.error("\nOne or more cuisines failed (missing images or over ceiling).");
  process.exit(1);
}
console.log("\nAll 20 background images optimized.");
