# Canvas Image Support Research

This note started as research on how OpenAgent could support Obsidian Canvas images with Codex. It now also records the first implemented pass so future work can distinguish shipped behavior from still-open follow-ups.

## Implemented status

OpenAgent now supports Canvas image files in the main Obsidian flow.

What works today:

- selected Canvas image file nodes are preserved as `selectionContext.imageFiles`
- the daemon sends them to Codex as real `localImage` input items
- image-only selection can start a new thread
- a single selected text node can pull connected or grouped image file nodes in as implicit context
- image-only turns send no synthetic wrapper prompt text
- text plus image turns keep the text prompt raw and send the image separately
- the OpenAgent panel now shows selected images in the conversation area

What still remains follow-up work:

- dedicated automated smoke for `follow-up text node + implicit connected image`
- richer panel behavior such as larger previews, zoom, or multiple attachment layouts
- optional compatibility fallback if a future runtime rejects the preferred `localImage` shape

## Short answer

Right now, Codex does not receive image data from Canvas in OpenAgent.

OpenAgent currently:

- reads selected Canvas `text` nodes
- reads selected Canvas `file` nodes only when they point to Markdown
- converts that selection into a plain text prompt
- sends that prompt to the Codex runtime as a single `text` input item

That means Canvas media cards can exist in Obsidian, but they are not part of the task context that reaches Codex.

## What Canvas itself supports

The repo already documents that Obsidian Canvas supports more than text and notes, including media cards:

- [docs/OBSIDIAN_CANVAS_REFERENCE.md](/Users/applefather/Documents/GitHub/openagent/docs/OBSIDIAN_CANVAS_REFERENCE.md:9)

Relevant line:

- `media cards from your vault`

So the limitation is not Canvas. The limitation is OpenAgent's selection and runtime pipeline.

## Current OpenAgent behavior

### 1. Selection resolver only keeps text and Markdown-backed file nodes

In the Obsidian plugin, `resolveCanvasSelection()` loops through selected nodes and only handles:

- `node.type === "text"`
- `node.type === "file"` followed by a Markdown-only check

Everything else is skipped with a warning:

- [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:1517)
- [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:1541)

This is the decisive current blocker.

### 2. File nodes are restricted to Markdown

`buildCanvasMarkdownFileSelectionEntry()` explicitly rejects non-`.md` file nodes:

- [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:1583)

So an image file on Canvas currently becomes a warning, not usable context.

### 3. Prompt building is text-only

Both the plugin preview prompt builder and the shared core prompt builder only serialize:

- `textBlocks`
- `markdownFiles`
- `warnings`
- optional user request text

References:

- [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:258)
- [packages/core/src/index.js](/Users/applefather/Documents/GitHub/openagent/packages/core/src/index.js:305)

There is no image payload in the selection contract today.

### 4. The daemon sends only a single text item to Codex

When OpenAgent starts a turn, it sends:

- `input: [{ type: "text", text: prompt, text_elements: [] }]`

Reference:

- [apps/openagent-daemon/src/server.js](/Users/applefather/Documents/GitHub/openagent/apps/openagent-daemon/src/server.js:402)

So even if the plugin started discovering image files, the runtime transport still would not pass them through.

## What "Codex working with a Canvas image" could mean

There are really three different levels of support.

### Option A: Path-only image awareness

OpenAgent includes image file paths in the prompt as plain text, for example:

`Image file 1: /absolute/path/to/mock.png`

What Codex can do:

- know that an image exists
- potentially open it later if the runtime/tooling allows file-based image inspection
- reason about workflow around the image

What Codex cannot reliably do from this alone:

- see pixels unless a later tool step explicitly loads the image

This is the lightest integration, but it is not true vision support by itself.

### Option B: Structured image attachment support

OpenAgent extends the task payload so selected Canvas images are passed as image inputs to the runtime, alongside text.

What Codex can do:

- directly reason over selected images during the turn
- answer questions about diagrams, UI screenshots, wireframes, photos, or exported canvases

This is the cleanest product experience if the runtime accepts image input items.

### Option C: Image-to-text preprocessing

OpenAgent converts the image into a text description before the main turn:

- OCR
- captioning
- screenshot analysis
- metadata extraction

Then it sends only text to Codex.

What Codex can do:

- reason over a textual description of the image

Tradeoff:

- simpler transport contract
- weaker fidelity than true multimodal input

## Best implementation paths

### Path 1: Add first-class image nodes to the selection contract

Recommended data shape:

```js
{
  canvasPath,
  nodeIds,
  textBlocks,
  markdownFiles,
  imageFiles: [
    {
      id,
      path,
      absolutePath,
      name,
      mimeType
    }
  ],
  warnings
}
```

Changes needed:

1. In the plugin selection resolver, detect Canvas `file` nodes that resolve to image extensions such as `png`, `jpg`, `jpeg`, `webp`, `gif`.
2. Keep Markdown files in `markdownFiles`, but store image files in `imageFiles`.
3. Update normalization in `packages/core/src/index.js`.
4. Update prompt preview UI to show selected images in the task context summary.
5. Update daemon turn creation so image items are included in `input`, not just text.

Why this is the best long-term path:

- keeps the selection model explicit
- preserves source node identity
- works naturally for screenshots, mockups, whiteboards, and design references on Canvas

### Path 2: Fallback to image path references when runtime image input is unavailable

If the Codex runtime cannot accept image items in this integration, OpenAgent can still add value by:

- carrying image paths in `selectionContext`
- telling Codex that those images are available on disk
- optionally instructing Codex to inspect them using available local image tooling

This is a good transitional step because it unblocks Canvas image selection without waiting for full multimodal transport.

### Path 3: Auto-OCR/caption image cards into sibling text context

For design-heavy or research-heavy canvases, OpenAgent could preprocess selected images into text blocks, for example:

- OCR extracted text from screenshots
- short auto-caption for a UI mockup
- alt-text-like summary for diagrams

This can be stored as generated context and appended to the prompt.

This is useful when:

- the runtime transport is text-only
- you want searchable, durable context in the graph

## Practical recommendation

The best staged rollout is:

1. Add `imageFiles` to the selection contract.
2. Surface them in the UI and task preview.
3. If the runtime supports image items, pass them directly in `turn/start`.
4. If not, fall back to image path references plus optional preprocessing.

That gives OpenAgent a safe incremental path:

- stage 1 improves selection fidelity
- stage 2 improves user clarity
- stage 3 unlocks real multimodal reasoning
- stage 4 provides a compatibility fallback

## Main code areas to change

- Selection resolver:
  [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:1483)
- Prompt preview builder:
  [apps/obsidian-plugin/main.js](/Users/applefather/Documents/GitHub/openagent/apps/obsidian-plugin/main.js:258)
- Shared selection normalization and prompt contract:
  [packages/core/src/index.js](/Users/applefather/Documents/GitHub/openagent/packages/core/src/index.js:31)
- Runtime turn submission:
  [apps/openagent-daemon/src/server.js](/Users/applefather/Documents/GitHub/openagent/apps/openagent-daemon/src/server.js:402)

## Bottom line

Codex can only work with Canvas images in OpenAgent if OpenAgent explicitly carries those images through the pipeline.

Today the pipeline drops them before the task is even created.

The most correct fix is to add image-aware selection data and pass multimodal input to the Codex runtime. If runtime support is limited, the next best approach is to preserve image file references and optionally generate text summaries from them.

## What the `codex` repo shows

The `codex` repo confirms that image support is supposed to be first-class protocol input, not prompt text.

### 1. App-server input already supports image items

The app-server docs describe `turn/start.input` as a mixed list of user input items:

- `{"type":"text","text":"..."}`
- `{"type":"image","url":"https://..."}`
- `{"type":"localImage","path":"/tmp/screenshot.png"}`

Reference:

- [/Users/applefather/Documents/GitHub/codex/codex-rs/app-server/README.md](/Users/applefather/Documents/GitHub/codex/codex-rs/app-server/README.md:463)

So OpenAgent does not need to invent a custom image protocol. The Codex app-server already has one.

### 2. SDKs expose image input as typed items

The Python SDK exposes:

- `TextInput`
- `ImageInput`
- `LocalImageInput`
- `SkillInput`
- `MentionInput`

Reference:

- [/Users/applefather/Documents/GitHub/codex/sdk/python/src/codex_app_server/_inputs.py](/Users/applefather/Documents/GitHub/codex/sdk/python/src/codex_app_server/_inputs.py:8)

The TypeScript SDK similarly accepts structured turn input and separates:

- prompt text
- local image paths

References:

- [/Users/applefather/Documents/GitHub/codex/sdk/typescript/src/thread.ts](/Users/applefather/Documents/GitHub/codex/sdk/typescript/src/thread.ts:22)
- [/Users/applefather/Documents/GitHub/codex/sdk/typescript/README.md](/Users/applefather/Documents/GitHub/codex/sdk/typescript/README.md:70)

This is an important design lesson: images should travel as their own item type, not be crammed into the text prompt.

### 3. Codex preprocesses local images before sending them

The Rust image utility:

- loads image bytes
- validates format
- resizes oversized images
- preserves PNG/JPEG/WebP where possible
- can return a base64 `data:` URL for prompt use

Reference:

- [/Users/applefather/Documents/GitHub/codex/codex-rs/utils/image/src/lib.rs](/Users/applefather/Documents/GitHub/codex/codex-rs/utils/image/src/lib.rs:1)

This is a strong pattern for OpenAgent:

- do not blindly stream arbitrary original image bytes
- normalize size and format first
- keep an explicit image-processing boundary

### 4. Codex preserves image items in downstream tool content too

Codex protocol models carry `InputImage` content items explicitly:

- [/Users/applefather/Documents/GitHub/codex/codex-rs/protocol/src/models.rs](/Users/applefather/Documents/GitHub/codex/codex-rs/protocol/src/models.rs:157)

And truncation helpers preserve image items even when text gets shortened:

- [/Users/applefather/Documents/GitHub/codex/codex-rs/utils/output-truncation/src/lib.rs](/Users/applefather/Documents/GitHub/codex/codex-rs/utils/output-truncation/src/lib.rs:27)

That means the multimodal item boundary is preserved across the runtime, not flattened away after initial ingestion.

### 5. Codex supports image detail controls

Codex has an `ImageDetail` concept with values like:

- `auto`
- `low`
- `high`
- `original`

References:

- [/Users/applefather/Documents/GitHub/codex/codex-rs/protocol/src/models.rs](/Users/applefather/Documents/GitHub/codex/codex-rs/protocol/src/models.rs:163)
- [/Users/applefather/Documents/GitHub/codex/codex-rs/tools/src/image_detail.rs](/Users/applefather/Documents/GitHub/codex/codex-rs/tools/src/image_detail.rs:1)

OpenAgent does not need this in v1, but it is a useful future extension for large screenshots or detailed diagrams.

## What the `remodex` repo shows

`remodex` is useful because it demonstrates an end-user attachment pipeline on top of Codex app-server.

### 1. Remodex creates two representations for each image

Its mobile attachment model stores:

- a small thumbnail for UI
- a full payload image for transport

Reference:

- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Models/CodexImageAttachment.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Models/CodexImageAttachment.swift:1)

The attachment pipeline:

- normalizes picked images to JPEG
- downsizes them
- builds a compact thumbnail
- stores the payload as a `data:image/jpeg;base64,...` URL

Reference:

- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Views/Turn/TurnAttachmentPipeline.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Views/Turn/TurnAttachmentPipeline.swift:1)

This is a very practical UI pattern for OpenAgent if Canvas images ever need preview chips or cached thumbnails.

### 2. Remodex intercepts pasted images early

The composer intercepts pasteboard images and downscales them before they ever enter the attachment pipeline.

Reference:

- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Views/Turn/TurnComposerInputTextView.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Views/Turn/TurnComposerInputTextView.swift:351)

The lesson for OpenAgent is similar:

- normalize image input as early as possible
- do not let arbitrary original media flow unchecked through the whole app

### 3. Remodex sends mixed `turn/start` input items

Remodex builds `turn/start.input` as an array of item objects and appends image items before text.

Reference:

- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Services/CodexService+ThreadsTurns.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Services/CodexService+ThreadsTurns.swift:1273)

It sends images as:

- `{"type":"image","url": "...data:image..."}`

and retries with:

- `image_url`

for compatibility with runtimes that expect the alternate field name.

Reference:

- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Services/CodexService+ThreadsTurns.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Services/CodexService+ThreadsTurns.swift:1006)

This is especially relevant for OpenAgent because it is very close to the app-server integration style already used in this repo.

### 4. Remodex treats file mentions differently from image attachments

In Remodex:

- images are part of `turn/start.input`
- file mentions are mostly stored in message/UI state

References:

- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Services/CodexService+Messages.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Services/CodexService+Messages.swift:844)
- [/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Views/Turn/TurnViewModel.swift](/Users/applefather/Documents/GitHub/remodex/CodexMobile/CodexMobile/Views/Turn/TurnViewModel.swift:1309)

That separation is useful for OpenAgent too:

- Markdown files are context documents
- images are multimodal inputs
- file mentions and graph references are UI/navigation metadata

These should not all be collapsed into one field.

### 5. Remodex sanitizes inline image history

The bridge strips giant inline `data:image/...` blobs out of history payloads and replaces them with a tiny placeholder reference for safe mobile rendering.

Reference:

- [/Users/applefather/Documents/GitHub/remodex/phodex-bridge/src/bridge.js](/Users/applefather/Documents/GitHub/remodex/phodex-bridge/src/bridge.js:1291)

This is a useful warning for OpenAgent:

- sending images is one concern
- persisting and replaying them is a separate concern

If OpenAgent later persists image-rich task history, it should avoid bloating local state or `.canvas` metadata with raw inline image payloads.

## Updated recommendation after checking `codex` and `remodex`

The best OpenAgent design is now clearer:

1. Follow `codex` for protocol shape.
   Use first-class image input items, ideally `localImage` when passing file paths from Canvas.
2. Follow `remodex` for intake hygiene.
   Normalize and bound image payloads before transport if direct path-based local images are not sufficient.
3. Keep Markdown files separate from images.
   Markdown remains document context; images become multimodal items.
4. Treat persistence carefully.
   Do not store giant `data:` payloads in long-lived task state or Canvas metadata unless there is a strong reason.

## OpenAgent-specific conclusion

After comparing both repos, the most natural OpenAgent upgrade path is:

- extend Canvas selection with `imageFiles`
- resolve those to absolute paths
- send them to Codex app-server as image input items instead of embedding image notes into prompt text

If the local runtime accepts `localImage`, that is the cleanest match for Canvas file nodes.

If not, a fallback can:

- preprocess the image
- convert it to a bounded `data:image/...` URL
- send it as a regular `image` item

That approach matches real patterns already used in `codex` and `remodex`, so it is much lower risk than inventing a custom OpenAgent-only image prompt format.
