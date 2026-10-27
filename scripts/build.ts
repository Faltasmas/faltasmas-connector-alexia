// Builds dist/connector.js: one IIFE that sets globalThis.FaltasmasConnector to the module
// namespace of src/index.ts; the connector is at FaltasmasConnector.connector.
// The loader contract lives in ../faltasmas-connectors/README.md.
import { mkdirSync } from "node:fs";

const GLOBAL_NAME = "FaltasmasConnector";
const OUT = "dist/connector.js";

mkdirSync("dist", { recursive: true });
// Bun.build ignores a global name for iife, so a virtual entry publishes the module namespace itself.
const entry = `${process.cwd()}/src/index.ts`;
const result = await Bun.build({
  entrypoints: ["virtual-entry.ts"],
  files: {
    "virtual-entry.ts": `import * as m from ${JSON.stringify(entry)};\n(globalThis as any).${GLOBAL_NAME} = m;`,
  },
  target: "browser",
  format: "iife",
  naming: "connector.js",
  outdir: "dist",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const text = await Bun.file(OUT).text();
const problems: string[] = [];
if (!text.includes(`globalThis.${GLOBAL_NAME}`)) problems.push(`does not define ${GLOBAL_NAME}`);
if (/\bnode:/.test(text)) problems.push("references node:");
if (/^\s*(import|export)\s/m.test(text)) problems.push("has an ES import/export statement");
if (/\brequire\s*\(/.test(text)) problems.push("calls require()");
if (/\bimport\s*\(/.test(text)) problems.push("uses dynamic import()");
if (problems.length) {
  console.error(`Bundle is not self-contained: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`built ${OUT} (${text.length} bytes)`);
