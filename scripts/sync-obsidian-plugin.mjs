import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { resolveOpenVaultPath } from "./obsidian-vault-utils.mjs";

const repoRoot = process.cwd();
const vaultPath = resolveOpenVaultPath();
const sourceDir = path.join(repoRoot, "apps", "obsidian-plugin");
const targetDir = path.join(vaultPath, ".obsidian", "plugins", "openagent");

fs.mkdirSync(targetDir, { recursive: true });

for (const fileName of ["main.js", "manifest.json", "styles.css", "package.json", "logo.png"]) {
  fs.copyFileSync(path.join(sourceDir, fileName), path.join(targetDir, fileName));
}

console.log(`Synced Obsidian plugin to ${targetDir}`);
