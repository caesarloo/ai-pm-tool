import esbuild from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const isProduction = process.argv[2] === "production";

async function syncDistAssets() {
  await mkdir("dist", { recursive: true });
  await cp("manifest.json", "dist/manifest.json");
  await cp("styles.css", "dist/styles.css");
}

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2020",
  platform: "node",
  logLevel: "info",
  minify: isProduction,
  sourcemap: isProduction ? false : "inline",
  treeShaking: true,
  outfile: "dist/main.js"
});

if (isProduction) {
  await context.rebuild();
  await syncDistAssets();
  await context.dispose();
} else {
  await syncDistAssets();
  await context.watch();
}
