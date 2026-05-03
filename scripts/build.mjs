import { mkdir, writeFile } from "node:fs/promises";
import esbuild from "esbuild";

const pluginDir = "com.codexusage.tracker.sdPlugin";

await mkdir(`${pluginDir}/bin`, { recursive: true });

await esbuild.build({
  bundle: true,
  entryPoints: ["src/plugin.ts"],
  external: [],
  format: "cjs",
  legalComments: "none",
  logLevel: "info",
  outfile: `${pluginDir}/bin/plugin.js`,
  platform: "node",
  target: "node20.20"
});

await writeFile(`${pluginDir}/bin/package.json`, '{ "type": "commonjs" }\n', "utf8");
