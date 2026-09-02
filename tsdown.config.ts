import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsdown";

const PLUGIN_ID = "dsh-personal-os";
const CSS_PREFIX = "\0dsh-personal-os-css:";
const CSS_SUFFIX = ".mjs";
const CLIENT_EXTERNALS = [
  "react",
  "react/jsx-runtime",
  "react-dom",
  "react-dom/client",
  "@deepseek-ai/cordis",
  "@deepseek-ai/dsh-client-runtime/client",
  "@deepseek-ai/dsh-client-locale/client",
  "@deepseek-ai/dsh-client-ui-primitives",
  "@deepseek-ai/dsh-client-ui-slots",
  "@deepseek-ai/dsh-api-remotes/client",
  "@deepseek-ai/dsh-client-connection/client",
] as const;

function inlineCssPlugin() {
  const cssFiles = new Map<string, string>();

  return {
    name: "dsh-personal-os-inline-css",
    resolveId(source: string, importer?: string) {
      if (!source.endsWith(".css")) return null;
      const file = importer === undefined ? source : resolve(dirname(importer), source);
      const virtualId = `${CSS_PREFIX}${basename(file)}${CSS_SUFFIX}`;
      cssFiles.set(virtualId, file);
      return virtualId;
    },
    async load(id: string) {
      if (!id.startsWith(CSS_PREFIX)) return null;
      const file = cssFiles.get(id);
      if (file === undefined) return null;
      const css = await readFile(file, "utf8");
      const tagId = `${PLUGIN_ID}/${basename(file)}`;
      const registry = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "src/client/pluginCss.ts",
      );
      return [
        `import { registerPluginCss } from ${JSON.stringify(registry)};`,
        `registerPluginCss(${JSON.stringify(tagId)}, ${JSON.stringify(css)});`,
        "export default {};",
      ].join("\n");
    },
  };
}

export default defineConfig([
  {
    name: `${PLUGIN_ID}/host`,
    entry: { index: "src/index.ts" },
    outDir: "lib",
    format: "esm",
    platform: "node",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${PLUGIN_ID}/typert`,
    entry: { "typert.host": "src/typert.host.ts" },
    outDir: "lib",
    format: "esm",
    platform: "node",
    target: "es2024",
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: "src/client/index.tsx" },
    outDir: "lib",
    format: "cjs",
    platform: "browser",
    target: "es2022",
    fixedExtension: false,
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: [...CLIENT_EXTERNALS],
      alwaysBundle: (id: string) =>
        CLIENT_EXTERNALS.includes(id as (typeof CLIENT_EXTERNALS)[number])
          ? undefined
          : true,
      onlyBundle: false,
    },
    plugins: [inlineCssPlugin()],
    outputOptions: {
      entryFileNames: "client.js",
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      intro: "var module = { exports: {} }; var exports = module.exports;",
      footer: "return module.exports; } });",
    },
  },
]);
