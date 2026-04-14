import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const repositoryFiles = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);
const trackedIgnoredFiles = execFileSync("git", ["ls-files", "-ci", "--exclude-standard", "-z"], {
  cwd: root,
  encoding: "utf8",
}).split("\0").filter(Boolean);

const ignoredContentFiles = new Set([
  "docs/OPEN_SOURCE_READINESS.md",
  "scripts/check-hygiene.mjs",
]);

const blockedPathPatterns = [
  /(^|\/)\.env($|\.)/,
  /(^|\/)\.DS_Store$/,
  /(^|\/).*\.p12$/,
  /(^|\/).*\.p8$/,
  /(^|\/).*\.pem$/,
  /(^|\/).*\.mobileprovision$/,
  /(^|\/)GoogleService-Info\.plist$/,
];

const blockedContentPatterns = [
  {
    name: "personal macOS path",
    pattern: /\/Users\/applefather|Documents\/Applefather|Documents\/GitHub\/openagent/,
  },
  {
    name: "private key header",
    pattern: /-----BEGIN (RSA |OPENSSH |EC |DSA |PRIVATE )?PRIVATE KEY-----/,
  },
  {
    name: "AWS access key",
    pattern: /AKIA[0-9A-Z]{16}/,
  },
  {
    name: "GitHub token",
    pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/,
  },
  {
    name: "OpenAI-style secret key",
    pattern: /sk-[A-Za-z0-9]{20,}/,
  },
  {
    name: "Slack token",
    pattern: /xox[baprs]-[A-Za-z0-9-]{20,}/,
  },
  {
    name: "credentialed URL",
    pattern: /https?:\/\/[^\s/]+:[^\s@]+@/,
  },
];

const findings = [];

for (const relativePath of trackedIgnoredFiles) {
  findings.push(`${relativePath}: tracked file still matches .gitignore`);
}

for (const relativePath of repositoryFiles) {
  const normalizedPath = relativePath.split(path.sep).join("/");
  for (const pattern of blockedPathPatterns) {
    if (pattern.test(normalizedPath)) {
      findings.push(`${relativePath}: file should not be committed`);
    }
  }

  if (ignoredContentFiles.has(normalizedPath)) {
    continue;
  }

  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    continue;
  }

  const content = fs.readFileSync(absolutePath);
  if (content.includes(0)) {
    continue;
  }

  const text = content.toString("utf8");
  const lines = text.split(/\r?\n/);
  for (const { name, pattern } of blockedContentPatterns) {
    for (let index = 0; index < lines.length; index += 1) {
      if (pattern.test(lines[index])) {
        findings.push(`${relativePath}:${index + 1}: ${name}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error("Repository hygiene check failed:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log(`Repository hygiene check passed for ${repositoryFiles.length} repository files.`);
