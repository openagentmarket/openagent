# Manual Install

Use this if you want to install the Obsidian plugin by hand.

## Steps

1. Open the Obsidian vault you want to use.
2. Create this folder in the vault:
   `.obsidian/plugins/openagent`
3. Copy these files from `apps/obsidian-plugin/` into that folder:
   `main.js`, `manifest.json`, `styles.css`, `package.json`, `logo.png`
4. In Obsidian, go to `Settings -> Community plugins` and enable `OpenAgent`.

`data.json` is not required up front. pOpenAgent creates and manages it in the vault.
