import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const files = [];

walk(root);

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
}

console.log(`Syntax check passed for ${files.length} JavaScript files.`);

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    if (fullPath.endsWith(".js") || fullPath.endsWith(".mjs")) {
      files.push(fullPath);
    }
  }
}
