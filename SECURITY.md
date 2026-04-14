# Security Policy

## Supported Versions

OpenAgent is pre-1.0. Security fixes are handled on the default branch.

## Reporting A Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories when
the repository is public. If advisories are not available, open a minimal issue
asking for a private contact path and avoid posting exploit details publicly.

Please include:

- affected commit or version
- steps to reproduce
- impact
- any known workaround

## Local Security Model

OpenAgent runs a local daemon on `127.0.0.1` and stores local auth/state under
`~/.openagent/`. The daemon requires the token from
`~/.openagent/daemon-config.json` on local HTTP requests.

Treat that token and daemon state as local secrets. Do not commit them.

Codex turns can operate on real repositories on disk. Use the workspace-only
sandbox for untrusted work, and only use full-access mode for trusted tasks.
