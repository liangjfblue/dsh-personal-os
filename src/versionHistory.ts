import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

export interface HistoryEntry {
  id: string;
  at: string;
  summary: string;
}

export class VersionHistory {
  constructor(readonly root: string) {}

  private async git(args: string[]): Promise<string> {
    const result = await execute("git", args, { cwd: this.root });
    return result.stdout.trim();
  }

  async initialize(): Promise<{ reused: boolean }> {
    let reused = true;
    try { await stat(join(this.root, ".git")); } catch {
      await this.git(["init"]);
      reused = false;
    }
    // The hidden history repo must round-trip user files byte-for-byte
    // regardless of the user's global git line-ending configuration.
    await this.git(["config", "core.autocrlf", "false"]);
    return { reused };
  }

  async checkpoint(summary: string): Promise<HistoryEntry | undefined> {
    await this.initialize();
    await this.git(["add", "--all", "--", "."]);
    const staged = await this.git(["diff", "--cached", "--name-only"]);
    if (staged === "") return undefined;
    await this.git([
      "-c", "user.name=Personal OS",
      "-c", "user.email=personal-os@local",
      "commit", "-m", summary,
    ]);
    return (await this.list(1))[0];
  }

  async list(limit = 50): Promise<HistoryEntry[]> {
    try {
      const output = await this.git(["log", `-${Math.max(1, limit)}`, "--format=%H%x1f%cI%x1f%s%x1e"]);
      return output.split("\x1e").map((row) => row.trim()).filter(Boolean).map((row) => {
        const [id = "", at = "", summary = ""] = row.split("\x1f");
        return { id, at, summary };
      });
    } catch {
      return [];
    }
  }

  async revert(commit: string, summary?: string): Promise<HistoryEntry> {
    if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error("Invalid checkpoint ID");
    await this.git(["revert", "--no-commit", commit]);
    const checkpoint = await this.checkpoint(summary ?? `Restore changes from ${commit.slice(0, 8)}`);
    if (!checkpoint) throw new Error("Checkpoint produced no changes");
    return checkpoint;
  }

  async remotes(): Promise<string[]> {
    const output = await this.git(["remote"]);
    return output === "" ? [] : output.split("\n");
  }
}
