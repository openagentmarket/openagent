# Obsidian Plugin Release

This is the release checklist for the packaged Obsidian plugin that ships through GitHub Releases.

Use this when you want to publish a new plugin version for manual installs.

## Release Inputs

The release version must match in both files:

- `apps/obsidian-plugin/package.json`
- `apps/obsidian-plugin/manifest.json`

The release workflow validates that the pushed tag matches that plugin version.

## What The Release Produces

Running the packaging script creates these files in `dist/obsidian-plugin-release`:

- `openagent-obsidian-plugin-vX.Y.Z.zip`
- `main.js`
- `manifest.json`
- `styles.css`
- `SHA256SUMS.txt`
- `release-notes.md`

The zip is the recommended install artifact. It expands to `.obsidian/plugins/openagent`.

## Local Prep

1. Update `apps/obsidian-plugin/package.json` and `apps/obsidian-plugin/manifest.json` to the new version.
2. Run:

```bash
pnpm run check
node ./scripts/package-obsidian-plugin-release.mjs vX.Y.Z
```

3. Confirm the generated files in `dist/obsidian-plugin-release`.

## Publish Flow

Important: create the tag after the release commit exists. Do not tag an older commit and then commit the version bump afterward.

1. Commit the release changes on `main`.
2. Push `main`.
3. Create the annotated tag on the release commit:

```bash
git tag -a vX.Y.Z -m "OpenAgent Obsidian Plugin vX.Y.Z"
```

4. Push the tag:

```bash
git push origin vX.Y.Z
```

Pushing the tag triggers `.github/workflows/release-obsidian-plugin.yml`.

## Verify On GitHub

After the workflow finishes, check the GitHub release for:

- `openagent-obsidian-plugin-vX.Y.Z.zip`
- `main.js`
- `manifest.json`
- `styles.css`
- `SHA256SUMS.txt`

Release notes come from `dist/obsidian-plugin-release/release-notes.md`.

## Recovery Notes

If the workflow fails with a version mismatch, the tag probably points at the wrong commit.

Typical fix:

1. Delete the bad local tag: `git tag -d vX.Y.Z`
2. Delete the bad remote tag: `git push origin :refs/tags/vX.Y.Z`
3. Recreate the tag on the correct commit.
4. Push the tag again.
