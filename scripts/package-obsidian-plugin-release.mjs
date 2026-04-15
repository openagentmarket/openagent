import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const pluginDir = path.join(repoRoot, "apps", "obsidian-plugin");
const distDir = path.join(repoRoot, "dist", "obsidian-plugin-release");
const releaseFiles = ["main.js", "manifest.json", "styles.css"];

const manifest = readJson(path.join(pluginDir, "manifest.json"));
const pluginPackage = readJson(path.join(pluginDir, "package.json"));
const cliReleaseTag = process.argv.slice(2).find((arg) => arg && arg !== "--") ?? "";
const releaseTag = cliReleaseTag || process.env.RELEASE_TAG || "";

if (manifest.version !== pluginPackage.version) {
  throw new Error(
    `Version mismatch: manifest.json has ${manifest.version} but package.json has ${pluginPackage.version}.`,
  );
}

if (releaseTag && releaseTag !== `v${manifest.version}`) {
  throw new Error(`Release tag ${releaseTag} does not match plugin version v${manifest.version}.`);
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });

for (const fileName of releaseFiles) {
  const sourcePath = path.join(pluginDir, fileName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing plugin release file: ${sourcePath}`);
  }

  fs.copyFileSync(sourcePath, path.join(distDir, fileName));
}

const checksums = releaseFiles
  .map((fileName) => `${sha256(path.join(distDir, fileName))}  ${fileName}`)
  .join("\n");
fs.writeFileSync(path.join(distDir, "SHA256SUMS.txt"), `${checksums}\n`, "utf8");

const releaseNotes = [
  `## OpenAgent Obsidian Plugin v${manifest.version}`,
  "",
  "Install with these release assets:",
  "- `main.js`",
  "- `manifest.json`",
  "- `styles.css`",
  "",
  "Manual install:",
  "1. Create `.obsidian/plugins/openagent` in your vault.",
  "2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.",
  "3. Enable `OpenAgent` in `Settings -> Community plugins`.",
  "",
  "Checksums are attached in `SHA256SUMS.txt`.",
  "",
].join("\n");

fs.writeFileSync(path.join(distDir, "release-notes.md"), releaseNotes, "utf8");

console.log(`Prepared Obsidian plugin release assets in ${distDir}`);
for (const fileName of [...releaseFiles, "SHA256SUMS.txt", "release-notes.md"]) {
  console.log(`- ${path.relative(repoRoot, path.join(distDir, fileName))}`);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}
