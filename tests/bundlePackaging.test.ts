import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));

// GNU tar reads "C:\..." as a remote host and Windows tar is not guaranteed,
// so the tarball is listed by walking the ustar headers directly.
function listTarEntries(tarball: string): string[] {
  const data = gunzipSync(readFileSync(tarball));
  const entries: string[] = [];
  for (let offset = 0; offset + 512 <= data.length; ) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number): string =>
      header.subarray(start, start + length).toString("latin1").replace(/\0.*$/, "");
    const name = field(0, 100);
    const prefix = field(345, 155);
    const size = Number.parseInt(field(124, 12).trim(), 8) || 0;
    if (name !== "") entries.push(prefix !== "" ? `${prefix}/${name}` : name);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function npmPackInvocation(packDirectory: string): { file: string; args: string[] } {
  if (process.platform !== "win32") {
    return { file: "npm", args: ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory] };
  }
  // spawnSync cannot execute npm's .cmd shim on Windows, so run npm's cli.js
  // with the current node executable directly.
  const shims = execFileSync("where", ["npm"], { encoding: "utf8" }).split(/\r?\n/);
  const cmd = shims.find((line) => line.toLowerCase().endsWith(".cmd"));
  const cli = cmd ? resolve(dirname(cmd), "node_modules", "npm", "bin", "npm-cli.js") : undefined;
  if (cli === undefined || !existsSync(cli)) throw new Error("npm-cli.js not found next to the npm.cmd shim");
  return { file: process.execPath, args: [cli, "pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory] };
}

function parsePackMetadata(output: string): Array<{ filename?: string }> {
  const match = output.match(/(?:^|\n)\[\s*\{/);
  if (!match || match.index === undefined) {
    throw new Error(`npm pack did not return JSON metadata:\n${output}`);
  }

  const jsonStart = match.index + (output[match.index] === "\n" ? 1 : 0);
  return JSON.parse(output.slice(jsonStart)) as Array<{ filename?: string }>;
}

describe("installable DeepSeek Harness plugin", () => {
  it("replaces the native sidebar through its packaged bundle patch", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
      files?: string[];
      scripts?: Record<string, string>;
      dsh?: { bundle?: { patch?: string }; client?: { inject?: string[] } };
    };
    const patch = readFileSync(resolve(root, "cordis.patch.yml"), "utf8").replace(/\r\n/g, "\n");

    expect(manifest.dsh?.bundle?.patch).toBe("./cordis.patch.yml");
    expect(manifest.files).toEqual(expect.arrayContaining([
      "lib/index.js",
      "lib/client.js",
      "lib/typert.host.js",
      "cordis.patch.yml",
      "README.md",
      "LICENSE",
      "docs",
      "skills",
      "assets",
    ]));
    expect(manifest.scripts?.prepare).toBe("npm run build");
    expect(manifest.dsh?.client?.inject).toEqual(expect.arrayContaining([
      "@deepseek-ai/dsh-client-ui-layout",
      "@deepseek-ai/dsh-client-ui-settings-plugins",
      "@deepseek-ai/dsh-client-ui-slots",
    ]));
    expect(patch).toMatch(/^- id: ui-sidebar\n  disabled: true$/m);
    expect(patch).toMatch(/^- insert:\n    - id: dsh-personal-os\n      name: dsh-personal-os$/m);
  });

  it("documents installation and removal through the DSH plugin lifecycle", () => {
    const readme = readFileSync(resolve(root, "README.md"), "utf8");

    expect(readme).toContain("plugin --profile web add");
    expect(readme).toContain("plugin --profile web remove dsh-personal-os");
    expect(readme).not.toContain("~/.dsh/profiles/web/package.json");
  });

  it("keeps all runtime entry points in the real package", () => {
    const packDirectory = mkdtempSync(join(tmpdir(), "dsh-personal-os-pack-"));
    try {
      // spawnSync cannot execute npm's .cmd shim on Windows without a shell.
      const npmPack = npmPackInvocation(packDirectory);
      const output = execFileSync(npmPack.file, npmPack.args, { cwd: root, encoding: "utf8" });
      const metadata = parsePackMetadata(output);
      const filename = metadata[0]?.filename;
      expect(filename).toBeTruthy();
      const entries = listTarEntries(join(packDirectory, filename!));
      expect(entries).toContain("package/lib/index.js");
      expect(entries).toContain("package/lib/client.js");
      expect(entries).toContain("package/lib/typert.host.js");
      expect(entries).toContain("package/cordis.patch.yml");
      expect(entries).toContain("package/docs/adr/0007-compose-dsh-capabilities-instead-of-building-a-parallel-runtime.md");
      expect(entries).toContain("package/docs/agents/domain.md");
      expect(entries).toContain("package/skills/personal-os/SKILL.md");
      expect(entries).toContain("package/assets/templates/knowledge.md");
    } finally {
      rmSync(packDirectory, { recursive: true, force: true });
    }
  });
});
