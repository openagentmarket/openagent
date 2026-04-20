# Safe Skill Sandbox MVP

This doc defines a narrow product wedge for safely trying third-party AI skills in the cloud before trusting them on a real machine or repo.

The core idea is simple:

- people keep finding useful skills in GitHub repos and social posts
- they want the upside of trying them
- they do not trust those skills enough to run them on their laptop, repo, tokens, or shell

That fear is rational. The product should not ask users to become sandboxing experts just to try a prompt bundle.

## One-Sentence Summary

Safe Skill Sandbox lets a user paste a skill repo URL, run it inside a locked cloud workspace, inspect what it tried to do, and only then promote the result into a real project.

## Why This Matters

Right now the default experience for shared skills is bad:

1. a creator posts a skill that looks useful
2. the user wants to try it
3. the user has to decide whether to trust random code, prompt rules, shell commands, and package installs on their own machine
4. most careful users stop here

The bottleneck is not discovery. It is trust.

The product wins if it turns "I don't dare try this" into "I can test this safely in 60 seconds."

## The User Problem

The first user is not a security engineer. It is a developer or designer using AI tools regularly who:

- sees skills shared in GitHub repos, tweets, Discord servers, and docs
- believes some of them are probably useful
- does not want to risk local files, SSH keys, API tokens, or repo state
- wants a clear preview of what the skill would do before letting it touch a real project

What the user is actually asking:

"Can I safely try this thing without gambling my machine?"

## Product Promise

The default product promise is:

- cloud-first
- ephemeral by default
- no access to the user's laptop
- no access to the user's real secrets
- no hidden command execution
- diff and command review before promotion

If we cannot hold those boundaries, we should not ship the feature.

## MVP Scope

The MVP handles one narrow job:

1. ingest a skill repo from a GitHub URL
2. scan it for obvious risk signals
3. run it inside a sealed cloud workspace
4. show the user what happened
5. let the user export the result as a patch or copyable output

The MVP does not need:

- marketplace features
- social discovery
- billing complexity
- team permissions
- local machine bridging
- full repo sync back into GitHub
- persistent hosted development environments

This is a trust product first, not a community product first.

## Primary User Flow

### 1. Paste a skill URL

The user pastes a GitHub URL, for example:

- a repo root
- a subdirectory containing `SKILL.md`
- a pinned commit URL

The UI immediately normalizes the target and recommends pinning a commit if the input points at a moving branch.

### 2. Static scan

Before any execution, the system clones the repo into a staging area and produces a quick risk summary:

- files found
- whether the repo is prompt-only or includes scripts
- suspicious command patterns
- network access attempts
- package install instructions
- references to secrets, env vars, shell execution, or home-directory paths
- whether the repo contains workflow files or automation hooks

The output should be blunt:

- `Prompt-only`
- `Prompt + shell helpers`
- `Exec-heavy`
- `Needs manual review`

### 3. Choose a run mode

The user picks one of a few very clear modes:

- `Inspect only`
  Static scan only, no execution.
- `Dry run`
  Allow prompt assembly and command planning, but do not execute shell commands.
- `Sandbox run`
  Execute inside a sealed cloud workspace with restricted filesystem and restricted network.

For the MVP, `Sandbox run` should be the recommended mode. That is the whole point.

### 4. Run in cloud sandbox

The system spins up an ephemeral runner with:

- a fresh workspace
- only the cloned skill repo and a disposable sample project
- no user secrets
- no SSH keys
- no mounted local home directory
- no access to the user's machine
- network disabled by default, or limited to a small allowlist

### 5. Show exactly what happened

The result page should answer four questions fast:

1. What files did the skill read?
2. What commands did it try to run?
3. What files did it create or modify?
4. Would I feel safe letting this near my real project?

Core surfaces:

- command timeline
- file diff
- network attempts
- dependency install attempts
- final output artifact, prompt, or patch

### 6. Promote or discard

After inspection, the user can:

- discard the run
- copy the generated prompt/output
- download a patch
- export a sanitized skill bundle

Notably absent from the MVP:

- "Apply directly to my laptop"

That should come later, if ever.

## Sample Projects

The runner should not start with an empty directory only. Many skills are only meaningful against a project.

The MVP should support two runner targets:

- `Blank sample app`
  A tiny canned React or Next sample for generic frontend skills.
- `Disposable repo copy`
  A cloud-side clone or upload of a target repo snapshot, never the user's live checkout.

For the first version, the blank sample app is enough to prove the wedge.

## Trust Model

This is the heart of the product.

### The system must assume the skill is untrusted

That means:

- untrusted prompts
- untrusted shell helpers
- untrusted install instructions
- untrusted package additions
- untrusted codegen behavior

The skill might be benign, sloppy, or hostile. The system design should not care.

### Security boundary

The boundary is not "we promise the skill is safe."

The boundary is:

"The skill can only affect an ephemeral machine we control, with no access to your laptop, secrets, or real repo."

### Defaults

Safe defaults should be non-negotiable:

- ephemeral runners only
- time-limited execution
- disk quota
- CPU and memory caps
- no host mounts
- no background persistence
- no inbound ports exposed publicly
- restricted egress
- full command logging

## MVP Security Rules

These rules should hold from day one:

### Filesystem

- the runner gets a temporary workspace only
- the workspace is deleted after the run
- there is no access to host paths outside the workspace
- there is no access to user home directories

### Secrets

- no user-provided long-lived secrets in MVP
- no automatic import of GitHub tokens, npm tokens, SSH keys, or cookies
- any future secret support must be per-run, scoped, and visible in UI

### Network

- default is `off`
- if a sample project needs package install, expose an explicit toggle
- if enabled, network should still be allowlisted where possible

### Execution

- every shell command is captured
- hidden background processes are killed at run end
- execution timeouts are enforced
- command output is retained for review

### Promotion

- the runner never pushes to GitHub in MVP
- the runner never opens PRs in MVP
- the runner only exports artifacts for user review

## System Architecture

The MVP can be built with four backend pieces.

### 1. Control API

Responsible for:

- accepting a skill URL
- normalizing repo and commit metadata
- creating runs
- returning run status and artifacts

Core objects:

- `SkillSource`
- `RiskReport`
- `SandboxRun`
- `RunArtifact`

### 2. Repo fetcher and scanner

Responsible for:

- cloning the target repo at a pinned commit
- locating `SKILL.md`, helper scripts, workflow files, and install instructions
- running static heuristics
- producing the first-pass risk report

The scanner is not a malware detector. It is a triage system.

### 3. Ephemeral runner

Responsible for:

- starting a sealed workspace
- mounting the skill repo and sample target project
- invoking the skill in the chosen run mode
- collecting command logs, file diffs, and artifacts

Implementation choices can vary:

- Firecracker microVM
- container plus gVisor
- container inside a hardened VM pool

The exact substrate matters less than the isolation contract.

### 4. Artifact store

Responsible for:

- storing logs
- storing diffs
- storing generated files
- expiring data automatically after a short retention window

Retention should be short by default. Think hours or days, not forever.

## Core Data Model

The MVP data model can stay small.

### `SkillSource`

- `id`
- `repoUrl`
- `commitSha`
- `subpath`
- `detectedFiles`
- `createdAt`

### `RiskReport`

- `id`
- `skillSourceId`
- `riskLevel`
- `classification`
- `findings`
- `recommendedMode`
- `createdAt`

### `SandboxRun`

- `id`
- `skillSourceId`
- `mode`
- `status`
- `targetType`
- `startedAt`
- `finishedAt`

### `RunArtifact`

- `id`
- `sandboxRunId`
- `type`
- `path`
- `summary`

## Risk Reporting

The risk report is one of the product's biggest trust levers.

It should be readable by a normal builder in under 20 seconds.

Suggested buckets:

- `Low`
  Prompt-only or prompt-dominant repo, no executable helpers detected.
- `Medium`
  Some helper scripts, install instructions, or package additions.
- `High`
  Heavy shell execution, network use, privileged operations, or unclear side effects.
- `Block`
  Direct attempts to access secrets, home directories, credentials, or unsafe host integrations.

Example findings:

- "Repo contains shell helper: `skill.sh`"
- "Prompt instructs the agent to install missing packages"
- "Workflow files detected under `.github/workflows`"
- "References to `process.env` found in helper script"
- "Writes are limited to workspace paths"

## UI Requirements

The UI does not need to be fancy. It needs to make trust legible.

The MVP UI should have three screens:

### Import screen

- skill URL input
- commit pin status
- basic explanation of what the product will and will not access

### Risk screen

- repo summary
- risk level
- key findings
- recommended run mode

### Run review screen

- command timeline
- network attempts
- file tree changes
- diff viewer
- export actions

The UI should constantly remind the user:

- this run happened in cloud
- no local machine access was granted
- nothing touches the real repo unless the user exports it

## Metrics

The MVP only needs a few metrics.

### User value metrics

- percent of imported skills that reach a completed risk report
- percent of scanned skills that are run in sandbox
- percent of runs that export a patch or output
- time from URL paste to first useful result

### Trust metrics

- percent of users who stop at static scan vs proceed to sandbox run
- percent of runs flagged medium or high risk
- false-positive complaints on risk reports
- support tickets that start with "I thought this would touch my machine"

The product is working if users feel safe enough to try more skills, not if they browse more cards.

## Non-Goals For MVP

Be disciplined here.

Do not build these first:

- hosted community marketplace
- skill ratings and comments
- cross-user trust graphs
- one-click apply to local repo
- automated GitHub PR creation
- persistent cloud workspaces
- local machine agent bridge
- paid team features

Those are second-order products. Trustable trial is the first-order product.

## Risks And Failure Modes

### 1. We oversell safety

If the product copy says or implies "safe" without naming the actual boundaries, trust dies the first time something surprising happens.

Mitigation:

- explain exact boundaries
- show exact run mode
- show exact resource and network limits

### 2. The scanner feels fake

If the risk report reads like generic AI sludge, users will not trust it.

Mitigation:

- cite real files
- cite real commands
- link each finding to actual evidence

### 3. The sandbox is too weak

If network and file restrictions are loose, the whole product premise collapses.

Mitigation:

- keep the MVP strict
- add flexibility only after trust is earned

### 4. The blank sample app gives misleading results

Some skills only shine on real projects. A toy sample may undersell them.

Mitigation:

- be explicit that blank sample runs test behavior and safety first
- add disposable repo copy next

## Suggested Build Order

### Phase 1

- GitHub URL import
- repo clone at pinned commit
- static scanner
- risk screen

This alone has value.

### Phase 2

- ephemeral runner
- blank sample app target
- command log and diff review
- export patch/output

This is the real MVP.

### Phase 3

- disposable repo copy target
- richer network policy controls
- reusable trust profiles for known skill authors

## What Success Looks Like

A user sees a cool skill on GitHub at 11:00 PM, pastes the URL into the product, gets a clear risk report, runs it in a cloud sandbox, inspects the diff, and says:

"Nice. This is useful. I still don't trust it on my laptop, but I don't need to. I can use the result."

That is the whole game.

## Open Questions

These are real product and engineering questions, but none should block the first wedge:

- Do we support only GitHub first, or generic git URLs?
- Do we allow package install in sandbox runs on day one?
- Do we build on blank sample apps only first, or include disposable repo uploads?
- How long do we retain artifacts by default?
- Do we let users save trust decisions for a skill author or commit?

## Recommendation

If we build this, start with:

- GitHub-only
- pinned commit imports
- static scan plus cloud sandbox
- blank sample app target
- patch export only

That is narrow, legible, and useful.
