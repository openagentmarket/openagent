import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const pluginDir = path.join(repoRoot, "apps", "obsidian-plugin");
const distDir = path.join(repoRoot, "dist", "obsidian-plugin-release");
const manualInstallFiles = ["main.js", "manifest.json", "styles.css"];
const bundledPluginFiles = [...manualInstallFiles, "logo.png"];

const manifest = readJson(path.join(pluginDir, "manifest.json"));
const pluginPackage = readJson(path.join(pluginDir, "package.json"));
const cliReleaseTag = process.argv.slice(2).find((arg) => arg && arg !== "--") ?? "";
const releaseTag = cliReleaseTag || process.env.RELEASE_TAG || "";
const archiveFileName = `openagent-obsidian-plugin-v${manifest.version}.zip`;
const bundleDir = path.join(distDir, manifest.id);

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
fs.mkdirSync(bundleDir, { recursive: true });

for (const fileName of bundledPluginFiles) {
  const sourcePath = path.join(pluginDir, fileName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Missing plugin release file: ${sourcePath}`);
  }

  fs.copyFileSync(sourcePath, path.join(bundleDir, fileName));
  if (manualInstallFiles.includes(fileName)) {
    fs.copyFileSync(sourcePath, path.join(distDir, fileName));
  }
}

createZipArchive({
  archiveFileName,
  bundleDirName: path.basename(bundleDir),
  cwd: distDir,
});

const checksumFiles = [...manualInstallFiles, archiveFileName];
const checksums = checksumFiles
  .map((fileName) => `${sha256(path.join(distDir, fileName))}  ${fileName}`)
  .join("\n");
fs.writeFileSync(path.join(distDir, "SHA256SUMS.txt"), `${checksums}\n`, "utf8");

const releaseNotes = [
  `## OpenAgent Obsidian Plugin v${manifest.version}`,
  "",
  "Recommended install asset:",
  `- \`${archiveFileName}\``,
  "",
  "Manual install assets:",
  "- `main.js`",
  "- `manifest.json`",
  "- `styles.css`",
  "",
  "Zip install:",
  "1. Create `.obsidian/plugins` in your vault if it does not exist yet.",
  `2. Extract \`${archiveFileName}\` into \`.obsidian/plugins\` so it creates \`.obsidian/plugins/${manifest.id}\`.`,
  "3. Enable `OpenAgent` in `Settings -> Community plugins`.",
  "",
  "Manual install:",
  `1. Create \`.obsidian/plugins/${manifest.id}\` in your vault.`,
  "2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.",
  "3. Enable `OpenAgent` in `Settings -> Community plugins`.",
  "",
  "Checksums are attached in `SHA256SUMS.txt`.",
  "",
].join("\n");

fs.writeFileSync(path.join(distDir, "release-notes.md"), releaseNotes, "utf8");

console.log(`Prepared Obsidian plugin release assets in ${distDir}`);
for (const fileName of [...manualInstallFiles, archiveFileName, "SHA256SUMS.txt", "release-notes.md"]) {
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

function createZipArchive({ archiveFileName, bundleDirName, cwd }) {
  execFileSync("zip", ["-r", archiveFileName, bundleDirName], {
    cwd,
    stdio: "pipe",
  });
}
