# Manual Install

Use this if you want to install the Obsidian plugin by hand.

## Steps

1. Open the latest [GitHub release](https://github.com/openagentmarket/openagent/releases/latest).
2. Recommended: download `openagent-obsidian-plugin-vX.Y.Z.zip`.
3. Open the Obsidian vault you want to use.
4. Create this folder in the vault if it does not exist yet:
   `.obsidian/plugins`
5. Extract the zip into `.obsidian/plugins` so it creates:
   `.obsidian/plugins/openagent`
6. In Obsidian, go to `Settings -> Community plugins` and enable `OpenAgent`.

## Manual Alternative

If you prefer to install the plugin files yourself:

1. Download `main.js`, `manifest.json`, and `styles.css` from the same release.
2. Create this folder in the vault:
   `.obsidian/plugins/openagent`
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. Enable `OpenAgent` in `Settings -> Community plugins`.

`data.json` is not required up front. OpenAgent creates and manages it in the vault.
