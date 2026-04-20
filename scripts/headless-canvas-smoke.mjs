import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { buildCanvasPrompt, createTaskBinding } from "../packages/core/src/index.js";
import { writeVisualSmokePng } from "./lib/visual-smoke-image.mjs";

const repoRoot = process.cwd();
const fixtureVaultPath = path.join(repoRoot, "fixtures", "obsidian-smoke");
const mixedCanvasRelativePath = path.join("OpenAgent Smoke", "smoke.canvas");
const mixedCanvasAbsolutePath = path.join(fixtureVaultPath, mixedCanvasRelativePath);
const markdownCanvasRelativePath = path.join("OpenAgent Smoke", "markdown-new-thread.canvas");
const markdownCanvasAbsolutePath = path.join(fixtureVaultPath, markdownCanvasRelativePath);
const generatedGroupFixture = createGeneratedGroupFixture();
const groupedCanvasRelativePath = path.join("OpenAgent Smoke", "group-default-context.canvas");
const groupedCanvasAbsolutePath = generatedGroupFixture.canvasAbsolutePath;
const generatedLinkedFixture = createGeneratedLinkedFixture();
const linkedCanvasRelativePath = path.join("OpenAgent Smoke", "linked-default-context.canvas");
const linkedCanvasAbsolutePath = generatedLinkedFixture.canvasAbsolutePath;
const generatedImageFixture = createGeneratedImageFixture();
const imageCanvasRelativePath = path.join("OpenAgent Smoke", "image-context.canvas");
const imageCanvasAbsolutePath = generatedImageFixture.canvasAbsolutePath;

const mixedSelection = resolveCanvasSelection(fixtureVaultPath, mixedCanvasAbsolutePath);
const mixedTask = createTaskBinding({
  cwd: repoRoot,
  status: "idle",
  title: mixedSelection.title,
  selectionContext: mixedSelection,
});
const mixedPrompt = buildCanvasPrompt(mixedSelection, "", { cwd: repoRoot });
const mixedNewThreadPrompt = buildNewThreadPromptFromSelection(mixedSelection);
const markdownSelection = resolveCanvasSelection(fixtureVaultPath, markdownCanvasAbsolutePath);
const markdownNewThreadPrompt = buildNewThreadPromptFromSelection(markdownSelection);
const groupedSelection = resolveCanvasSelection(generatedGroupFixture.vaultRoot, groupedCanvasAbsolutePath, ["group-prompt"]);
const groupedNewThreadSelection = addImplicitCanvasMarkdownContext(generatedGroupFixture.vaultRoot, groupedSelection);
const groupedNewThreadPrompt = buildNewThreadPromptFromSelection(groupedNewThreadSelection);
const linkedSelection = resolveCanvasSelection(generatedLinkedFixture.vaultRoot, linkedCanvasAbsolutePath, ["linked-prompt"]);
const linkedNewThreadSelection = addImplicitCanvasMarkdownContext(generatedLinkedFixture.vaultRoot, linkedSelection);
const linkedNewThreadPrompt = buildNewThreadPromptFromSelection(linkedNewThreadSelection);
const imageSelection = resolveCanvasSelection(generatedImageFixture.vaultRoot, imageCanvasAbsolutePath, ["image-prompt", "image-file"]);
const imageTask = createTaskBinding({
  cwd: repoRoot,
  status: "idle",
  title: imageSelection.title,
  selectionContext: imageSelection,
});
const imagePrompt = buildCanvasPrompt(imageSelection, "", { cwd: repoRoot });
const imageNewThreadPrompt = buildNewThreadPromptFromSelection(imageSelection);
const imageOnlySelection = resolveCanvasSelection(generatedImageFixture.vaultRoot, imageCanvasAbsolutePath, ["image-file"]);
const imageOnlyTask = createTaskBinding({
  cwd: repoRoot,
  status: "idle",
  title: imageOnlySelection.title,
  selectionContext: imageOnlySelection,
});
const imageOnlyNewThreadPrompt = buildNewThreadPromptFromSelection(imageOnlySelection);

assert(mixedSelection.canvasPath === mixedCanvasRelativePath, `Unexpected canvas path: ${mixedSelection.canvasPath}`);
assert(mixedSelection.nodeIds.length === 2, `Expected 2 selected nodes, received ${mixedSelection.nodeIds.length}`);
assert(mixedSelection.textBlocks.length === 1, `Expected 1 text node, received ${mixedSelection.textBlocks.length}`);
assert(mixedSelection.markdownFiles.length === 1, `Expected 1 markdown file, received ${mixedSelection.markdownFiles.length}`);
assert(
  mixedSelection.markdownFiles[0].content.includes("Expected behavior: the plugin should capture this file node and create a task successfully."),
  "Fixture markdown content was not captured into the selection."
);
assert(mixedPrompt.includes("Use the saved Canvas context and continue with the most helpful next step."), "Prompt footer is missing.");
assert(
  mixedPrompt.includes(`Markdown file 1: ${normalizePromptPath(path.join(fixtureVaultPath, "OpenAgent Smoke", "context.md"))}`),
  "Prompt did not include the markdown node path."
);
assert(mixedTask.cwd === repoRoot, `Task cwd mismatch: ${mixedTask.cwd}`);
assert(mixedTask.title === "OpenAgent smoke test. Capture this canvas selection and create a task.", "Task title mismatch.");
assert(
  mixedNewThreadPrompt.includes("Text node 1:\nOpenAgent smoke test. Capture this canvas selection and create a task."),
  "Mixed new-thread prompt did not include the selected text node."
);
assert(
  mixedNewThreadPrompt.includes(`Markdown file 1: ${normalizePromptPath(path.join(fixtureVaultPath, "OpenAgent Smoke", "context.md"))}`),
  "Mixed new-thread prompt did not include the selected markdown file path."
);
assert(
  mixedNewThreadPrompt.includes("OpenAgent smoke test. Capture this canvas selection and create a task."),
  "Mixed new-thread prompt did not preserve the selected text node."
);

assert(markdownSelection.canvasPath === markdownCanvasRelativePath, `Unexpected markdown canvas path: ${markdownSelection.canvasPath}`);
assert(markdownSelection.nodeIds.length === 1, `Expected 1 selected markdown node, received ${markdownSelection.nodeIds.length}`);
assert(markdownSelection.textBlocks.length === 0, `Expected 0 text nodes, received ${markdownSelection.textBlocks.length}`);
assert(markdownSelection.markdownFiles.length === 1, `Expected 1 markdown file, received ${markdownSelection.markdownFiles.length}`);
assert(markdownSelection.title === "markdown-thread-context", `Markdown selection title mismatch: ${markdownSelection.title}`);
assert(
  markdownSelection.markdownFiles[0].content.includes("This markdown file should be used as the primary context for a new thread."),
  "Markdown-only fixture content was not captured into the selection."
);
assert(
  !markdownNewThreadPrompt.includes("User request:\n"),
  "Markdown-only prompt should not wrap generated guidance in a synthetic user request label."
);
assert(
  markdownNewThreadPrompt.includes(`Markdown file 1: ${normalizePromptPath(path.join(fixtureVaultPath, "OpenAgent Smoke", "markdown-thread-context.md"))}`),
  "Markdown-only prompt did not include the selected markdown file path."
);
assert(groupedSelection.canvasPath === groupedCanvasRelativePath, `Unexpected grouped canvas path: ${groupedSelection.canvasPath}`);
assert(groupedSelection.nodeIds.length === 1, `Expected 1 selected grouped node, received ${groupedSelection.nodeIds.length}`);
assert(groupedSelection.textBlocks.length === 1, `Expected 1 grouped text node, received ${groupedSelection.textBlocks.length}`);
assert(groupedSelection.markdownFiles.length === 0, `Expected grouped selection to start without explicit markdown files, received ${groupedSelection.markdownFiles.length}`);
assert(groupedNewThreadSelection.markdownFiles.length === 1, `Expected 1 implicit markdown file from the group, received ${groupedNewThreadSelection.markdownFiles.length}`);
assert(
  groupedNewThreadSelection.markdownFiles[0].path === "OpenAgent Smoke/group-default-context.md",
  `Unexpected implicit grouped markdown path: ${groupedNewThreadSelection.markdownFiles[0]?.path || "(missing)"}`
);
assert(
  groupedNewThreadSelection.markdownFiles[0].content.includes("GROUP_DEFAULT_CONTEXT_OK"),
  "Grouped markdown context content was not captured."
);
assert(
  groupedNewThreadPrompt.includes(`Markdown file 1: ${normalizePromptPath(generatedGroupFixture.markdownAbsolutePath)}`),
  "Grouped new-thread prompt did not include the implicit grouped markdown file path."
);
assert(
  !groupedNewThreadPrompt.includes("Outside Context"),
  "Grouped new-thread prompt incorrectly included markdown outside the selected group."
);
assert(linkedSelection.canvasPath === linkedCanvasRelativePath, `Unexpected linked canvas path: ${linkedSelection.canvasPath}`);
assert(linkedSelection.nodeIds.length === 1, `Expected 1 linked text node, received ${linkedSelection.nodeIds.length}`);
assert(linkedSelection.textBlocks.length === 1, `Expected 1 linked text node block, received ${linkedSelection.textBlocks.length}`);
assert(linkedSelection.markdownFiles.length === 0, `Expected linked selection to start without explicit markdown files, received ${linkedSelection.markdownFiles.length}`);
assert(linkedNewThreadSelection.markdownFiles.length === 1, `Expected 1 implicit markdown file from the linked edge, received ${linkedNewThreadSelection.markdownFiles.length}`);
assert(
  linkedNewThreadSelection.markdownFiles[0].path === "OpenAgent Smoke/linked-default-context.md",
  `Unexpected implicit linked markdown path: ${linkedNewThreadSelection.markdownFiles[0]?.path || "(missing)"}`
);
assert(
  linkedNewThreadSelection.markdownFiles[0].content.includes("LINKED_DEFAULT_CONTEXT_OK"),
  "Linked markdown context content was not captured."
);
assert(
  linkedNewThreadPrompt.includes(`Markdown file 1: ${normalizePromptPath(generatedLinkedFixture.markdownAbsolutePath)}`),
  "Linked new-thread prompt did not include the implicitly linked markdown file path."
);
assert(
  !linkedNewThreadPrompt.includes("UNLINKED_CONTEXT_SHOULD_NOT_APPEAR"),
  "Linked new-thread prompt incorrectly included markdown from an unlinked file node."
);
assert(imageSelection.canvasPath === imageCanvasRelativePath, `Unexpected image canvas path: ${imageSelection.canvasPath}`);
assert(imageSelection.nodeIds.length === 2, `Expected 2 selected image-context nodes, received ${imageSelection.nodeIds.length}`);
assert(imageSelection.textBlocks.length === 1, `Expected 1 image-context text node, received ${imageSelection.textBlocks.length}`);
assert(imageSelection.markdownFiles.length === 0, `Expected 0 image-context markdown files, received ${imageSelection.markdownFiles.length}`);
assert(imageSelection.imageFiles.length === 1, `Expected 1 image file, received ${imageSelection.imageFiles.length}`);
assert(
  imageSelection.imageFiles[0].path === "OpenAgent Smoke/image-context.png",
  `Unexpected image file path: ${imageSelection.imageFiles[0]?.path || "(missing)"}`
);
assert(
  imageSelection.imageFiles[0].absolutePath === generatedImageFixture.imageAbsolutePath,
  `Unexpected image absolute path: ${imageSelection.imageFiles[0]?.absolutePath || "(missing)"}`
);
assert(
  imageSelection.imageFiles[0].mimeType === "image/png",
  `Unexpected image mime type: ${imageSelection.imageFiles[0]?.mimeType || "(missing)"}`
);
assert(
  imagePrompt.includes(`Image file 1: OpenAgent Smoke/image-context.png`),
  "Image prompt did not include the selected image file."
);
assert(
  imageNewThreadPrompt === "Inspect the selected image and explain what kind of asset it is.",
  `Unexpected image new-thread prompt: ${imageNewThreadPrompt || "(empty)"}`
);
assert(
  imageNewThreadPrompt.includes("Inspect the selected image and explain what kind of asset it is."),
  "Image new-thread prompt did not preserve the selected text node."
);
assert(imageTask.selectionContext.imageFiles.length === 1, `Task selection image count mismatch: ${imageTask.selectionContext.imageFiles.length}`);
assert(imageOnlySelection.canvasPath === imageCanvasRelativePath, `Unexpected image-only canvas path: ${imageOnlySelection.canvasPath}`);
assert(imageOnlySelection.nodeIds.length === 1, `Expected 1 selected image-only node, received ${imageOnlySelection.nodeIds.length}`);
assert(imageOnlySelection.textBlocks.length === 0, `Expected 0 image-only text nodes, received ${imageOnlySelection.textBlocks.length}`);
assert(imageOnlySelection.markdownFiles.length === 0, `Expected 0 image-only markdown files, received ${imageOnlySelection.markdownFiles.length}`);
assert(imageOnlySelection.imageFiles.length === 1, `Expected 1 image-only file, received ${imageOnlySelection.imageFiles.length}`);
assert(
  imageOnlyNewThreadPrompt === "",
  `Expected image-only new-thread prompt to be empty, received: ${imageOnlyNewThreadPrompt || "(non-empty)"}`
);
assert(
  !imageOnlyNewThreadPrompt.includes(`Image file 1: OpenAgent Smoke/image-context.png`),
  "Image-only new-thread prompt should not include image wrapper text."
);
assert(imageOnlyTask.selectionContext.imageFiles.length === 1, `Image-only task selection image count mismatch: ${imageOnlyTask.selectionContext.imageFiles.length}`);

console.log(`Headless canvas smoke passed for ${mixedTask.taskId}`);
console.log(JSON.stringify({
  mixedTaskId: mixedTask.taskId,
  mixedTitle: mixedTask.title,
  mixedSourceRef: mixedTask.sourceRef,
  cwd: mixedTask.cwd,
  mixedCanvasPath: mixedSelection.canvasPath,
  mixedNodeIds: mixedSelection.nodeIds,
  markdownCanvasPath: markdownSelection.canvasPath,
  markdownNodeIds: markdownSelection.nodeIds,
  groupedCanvasPath: groupedSelection.canvasPath,
  groupedNodeIds: groupedSelection.nodeIds,
  groupedImplicitMarkdownPath: groupedNewThreadSelection.markdownFiles[0].path,
  linkedCanvasPath: linkedSelection.canvasPath,
  linkedNodeIds: linkedSelection.nodeIds,
  linkedImplicitMarkdownPath: linkedNewThreadSelection.markdownFiles[0].path,
  imageTaskId: imageTask.taskId,
  imageCanvasPath: imageSelection.canvasPath,
  imageNodeIds: imageSelection.nodeIds,
  imagePath: imageSelection.imageFiles[0].path,
  imageOnlyTaskId: imageOnlyTask.taskId,
  imageOnlyNodeIds: imageOnlySelection.nodeIds,
}, null, 2));

function resolveCanvasSelection(vaultRoot, canvasPath, selectedNodeIds = null) {
  const parsed = JSON.parse(fs.readFileSync(canvasPath, "utf8"));
  const selectedIdSet = Array.isArray(selectedNodeIds) && selectedNodeIds.length > 0
    ? new Set(selectedNodeIds.map((nodeId) => String(nodeId)))
    : null;
  const textBlocks = [];
  const markdownFiles = [];
  const imageFiles = [];
  const warnings = [];

  for (const node of Array.isArray(parsed?.nodes) ? parsed.nodes : []) {
    const nodeId = String(node?.id || "");
    if (!nodeId) {
      continue;
    }

    if (selectedIdSet && !selectedIdSet.has(nodeId)) {
      continue;
    }

    if (node.type === "text") {
      const text = typeof node.text === "string" ? node.text.trim() : "";
      if (text) {
        textBlocks.push({ id: nodeId, text });
      } else {
        warnings.push(`Text node ${nodeId} is empty.`);
      }
      continue;
    }

    if (node.type !== "file") {
      warnings.push(`Unsupported canvas node type skipped: ${node.type || "unknown"}`);
      continue;
    }

    const relativeFilePath = typeof node.file === "string" ? node.file.trim() : "";
    const absoluteFilePath = path.join(vaultRoot, relativeFilePath);
    if (!relativeFilePath || !fs.existsSync(absoluteFilePath)) {
      warnings.push(`Missing file node target: ${relativeFilePath}`);
      continue;
    }

    const extension = path.extname(absoluteFilePath).toLowerCase();
    if (extension === ".md") {
      markdownFiles.push({
        id: nodeId,
        path: relativeFilePath,
        absolutePath: absoluteFilePath,
        name: path.basename(relativeFilePath, ".md"),
        content: fs.readFileSync(absoluteFilePath, "utf8"),
      });
      continue;
    }

    if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".gif" || extension === ".webp") {
      imageFiles.push({
        id: nodeId,
        path: relativeFilePath,
        absolutePath: absoluteFilePath,
        name: path.basename(relativeFilePath, extension),
        mimeType: imageMimeTypeForExtension(extension),
      });
      continue;
    }

    if (selectedIdSet && selectedIdSet.has(nodeId)) {
      warnings.push(`Unsupported file node type skipped: ${relativeFilePath}`);
    }
  }

  return {
    canvasPath: path.relative(vaultRoot, canvasPath),
    canvasName: path.basename(canvasPath, ".canvas"),
    nodeIds: [
      ...textBlocks.map((block) => block.id),
      ...markdownFiles.map((file) => file.id),
      ...imageFiles.map((file) => file.id),
    ].sort(),
    textBlocks,
    markdownFiles,
    imageFiles,
    warnings,
    title: deriveTitle(path.basename(canvasPath, ".canvas"), textBlocks, markdownFiles, imageFiles),
  };
}

function imageMimeTypeForExtension(extension) {
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".gif") {
    return "image/gif";
  }
  if (extension === ".webp") {
    return "image/webp";
  }
  return "image/png";
}

function createGeneratedGroupFixture() {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-headless-group-"));
  const smokeDir = path.join(vaultRoot, "OpenAgent Smoke");
  const canvasAbsolutePath = path.join(smokeDir, "group-default-context.canvas");
  const markdownAbsolutePath = path.join(smokeDir, "group-default-context.md");
  fs.mkdirSync(smokeDir, { recursive: true });
  fs.writeFileSync(markdownAbsolutePath, [
    "# Group Default Context",
    "",
    "The grouped markdown file should be included automatically when the text",
    "node in the same canvas group starts a new thread.",
    "",
    "Expected phrase: GROUP_DEFAULT_CONTEXT_OK",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(canvasAbsolutePath, `${JSON.stringify({
    nodes: [
      {
        id: "group-context",
        type: "group",
        x: 0,
        y: 0,
        width: 920,
        height: 520,
        label: "research",
      },
      {
        id: "group-prompt",
        type: "text",
        x: 80,
        y: 80,
        width: 320,
        height: 160,
        text: "Use the grouped markdown context automatically and summarize the next step.",
      },
      {
        id: "group-file",
        type: "file",
        x: 500,
        y: 80,
        width: 320,
        height: 260,
        file: "OpenAgent Smoke/group-default-context.md",
      },
      {
        id: "outside-file",
        type: "file",
        x: 980,
        y: 80,
        width: 320,
        height: 260,
        file: "OpenAgent Smoke/context.md",
      },
    ],
    edges: [],
  }, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(smokeDir, "context.md"), [
    "# Outside Context",
    "",
    "This file sits outside the selected group and should not be auto-included.",
    "",
  ].join("\n"), "utf8");
  return {
    vaultRoot,
    canvasAbsolutePath,
    markdownAbsolutePath,
  };
}

function createGeneratedLinkedFixture() {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-headless-linked-"));
  const smokeDir = path.join(vaultRoot, "OpenAgent Smoke");
  const canvasAbsolutePath = path.join(smokeDir, "linked-default-context.canvas");
  const markdownAbsolutePath = path.join(smokeDir, "linked-default-context.md");
  const unrelatedMarkdownAbsolutePath = path.join(smokeDir, "unlinked-context.md");
  fs.mkdirSync(smokeDir, { recursive: true });
  fs.writeFileSync(markdownAbsolutePath, [
    "# Linked Default Context",
    "",
    "This markdown file should be included automatically when the selected text",
    "node is connected to it by a canvas edge.",
    "",
    "Expected phrase: LINKED_DEFAULT_CONTEXT_OK",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(unrelatedMarkdownAbsolutePath, [
    "# Unlinked Context",
    "",
    "This file is present on the canvas but not connected to the selected node.",
    "",
    "Expected phrase: UNLINKED_CONTEXT_SHOULD_NOT_APPEAR",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(canvasAbsolutePath, `${JSON.stringify({
    nodes: [
      {
        id: "linked-prompt",
        type: "text",
        x: 80,
        y: 80,
        width: 320,
        height: 160,
        text: "Use the linked markdown context automatically and propose the edit.",
      },
      {
        id: "linked-file",
        type: "file",
        x: 500,
        y: 80,
        width: 320,
        height: 260,
        file: "OpenAgent Smoke/linked-default-context.md",
      },
      {
        id: "unlinked-file",
        type: "file",
        x: 980,
        y: 80,
        width: 320,
        height: 260,
        file: "OpenAgent Smoke/unlinked-context.md",
      },
    ],
    edges: [
      {
        id: "linked-edge",
        fromNode: "linked-prompt",
        toNode: "linked-file",
      },
    ],
  }, null, 2)}\n`, "utf8");
  return {
    vaultRoot,
    canvasAbsolutePath,
    markdownAbsolutePath,
  };
}

function createGeneratedImageFixture() {
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openagent-headless-image-"));
  const smokeDir = path.join(vaultRoot, "OpenAgent Smoke");
  const canvasAbsolutePath = path.join(smokeDir, "image-context.canvas");
  const imageAbsolutePath = path.join(smokeDir, "image-context.png");
  fs.mkdirSync(smokeDir, { recursive: true });
  writeVisualSmokePng(imageAbsolutePath);
  fs.writeFileSync(canvasAbsolutePath, `${JSON.stringify({
    nodes: [
      {
        id: "image-prompt",
        type: "text",
        x: 80,
        y: 80,
        width: 360,
        height: 160,
        text: "Inspect the selected image and explain what kind of asset it is.",
      },
      {
        id: "image-file",
        type: "file",
        x: 500,
        y: 80,
        width: 320,
        height: 240,
        file: "OpenAgent Smoke/image-context.png",
      },
    ],
    edges: [
      {
        id: "image-edge",
        fromNode: "image-prompt",
        toNode: "image-file",
      },
    ],
  }, null, 2)}\n`, "utf8");
  return {
    vaultRoot,
    canvasAbsolutePath,
    imageAbsolutePath,
  };
}

function collectConnectedCanvasNodeIds(edges, sourceNodeId) {
  const normalizedSourceNodeId = String(sourceNodeId || "").trim();
  const connectedNodeIds = new Set();
  if (!normalizedSourceNodeId) {
    return connectedNodeIds;
  }

  (Array.isArray(edges) ? edges : []).forEach((edge) => {
    const fromNodeId = String(edge?.fromNode || "").trim();
    const toNodeId = String(edge?.toNode || "").trim();
    if (fromNodeId === normalizedSourceNodeId && toNodeId) {
      connectedNodeIds.add(toNodeId);
    }
    if (toNodeId === normalizedSourceNodeId && fromNodeId) {
      connectedNodeIds.add(fromNodeId);
    }
  });

  return connectedNodeIds;
}

function appendImplicitMarkdownFiles(vaultRoot, nodes, warnings, collectedFiles, seenNodeIds, predicate) {
  const candidateNodes = (Array.isArray(nodes) ? nodes : [])
    .filter((node) => {
      const nodeId = String(node?.id || "").trim();
      return nodeId
        && !seenNodeIds.has(nodeId)
        && String(node?.type || "").trim() === "file"
        && predicate(node);
    })
    .sort(compareCanvasNodeOrder);

  candidateNodes.forEach((node) => {
    const markdownFile = buildCanvasMarkdownFileSelectionEntry(vaultRoot, node, warnings);
    if (!markdownFile) {
      return;
    }

    const nodeId = String(markdownFile.id || "").trim();
    if (!nodeId || seenNodeIds.has(nodeId)) {
      return;
    }

    seenNodeIds.add(nodeId);
    collectedFiles.push(markdownFile);
  });
}

function addImplicitCanvasMarkdownContext(vaultRoot, selection) {
  const canvasPath = String(selection?.canvasPath || "").trim();
  const nodeIds = Array.isArray(selection?.nodeIds) ? selection.nodeIds.map((nodeId) => String(nodeId)).filter(Boolean) : [];
  const textBlocks = Array.isArray(selection?.textBlocks) ? selection.textBlocks : [];
  const markdownFiles = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles : [];
  if (!canvasPath || nodeIds.length !== 1 || textBlocks.length !== 1 || markdownFiles.length > 0) {
    return selection;
  }

  const absoluteCanvasPath = path.join(vaultRoot, canvasPath);
  if (!fs.existsSync(absoluteCanvasPath)) {
    return selection;
  }

  const parsed = JSON.parse(fs.readFileSync(absoluteCanvasPath, "utf8"));
  const nodes = Array.isArray(parsed?.nodes) ? parsed.nodes : [];
  const edges = Array.isArray(parsed?.edges) ? parsed.edges : [];
  const sourceNode = nodes.find((node) => String(node?.id || "") === nodeIds[0]) || null;
  if (!sourceNode || String(sourceNode?.type || "") !== "text") {
    return selection;
  }

  const nextWarnings = Array.isArray(selection?.warnings) ? [...selection.warnings] : [];
  const implicitMarkdownFiles = [];
  const seenNodeIds = new Set(markdownFiles.map((file) => String(file?.id || "").trim()).filter(Boolean));
  const connectedNodeIds = collectConnectedCanvasNodeIds(edges, nodeIds[0]);
  appendImplicitMarkdownFiles(
    vaultRoot,
    nodes,
    nextWarnings,
    implicitMarkdownFiles,
    seenNodeIds,
    (node) => connectedNodeIds.has(String(node?.id || "").trim())
  );

  const containingGroup = findSmallestCanvasGroupForNode(nodes, sourceNode);
  if (containingGroup) {
    appendImplicitMarkdownFiles(
      vaultRoot,
      nodes,
      nextWarnings,
      implicitMarkdownFiles,
      seenNodeIds,
      (node) => String(node?.id || "").trim() !== nodeIds[0]
        && doesCanvasGroupContainNode(containingGroup, node)
    );
  }

  if (implicitMarkdownFiles.length === 0) {
    return selection;
  }

  return {
    ...selection,
    markdownFiles: implicitMarkdownFiles,
    warnings: nextWarnings,
  };
}

function buildCanvasMarkdownFileSelectionEntry(vaultRoot, node, warnings) {
  const relativeFilePath = typeof node?.file === "string" ? node.file.trim() : "";
  const absoluteFilePath = path.join(vaultRoot, relativeFilePath);
  if (!relativeFilePath || !fs.existsSync(absoluteFilePath)) {
    warnings.push(`Missing file node target: ${relativeFilePath}`);
    return null;
  }

  if (path.extname(absoluteFilePath).toLowerCase() !== ".md") {
    warnings.push(`Unsupported file node type skipped: ${relativeFilePath}`);
    return null;
  }

  return {
    id: String(node?.id || ""),
    path: relativeFilePath,
    absolutePath: absoluteFilePath,
    name: path.basename(relativeFilePath, ".md"),
    content: fs.readFileSync(absoluteFilePath, "utf8"),
  };
}

function getCanvasNodeCenter(node) {
  return {
    x: toFiniteNumber(node?.x, 0) + (Math.max(0, toFiniteNumber(node?.width, 0)) / 2),
    y: toFiniteNumber(node?.y, 0) + (Math.max(0, toFiniteNumber(node?.height, 0)) / 2),
  };
}

function doesCanvasGroupContainNode(groupNode, candidateNode) {
  if (String(groupNode?.type || "") !== "group") {
    return false;
  }

  const center = getCanvasNodeCenter(candidateNode);
  const groupX = toFiniteNumber(groupNode?.x, 0);
  const groupY = toFiniteNumber(groupNode?.y, 0);
  const groupWidth = Math.max(0, toFiniteNumber(groupNode?.width, 0));
  const groupHeight = Math.max(0, toFiniteNumber(groupNode?.height, 0));
  return (
    center.x >= groupX
    && center.x <= groupX + groupWidth
    && center.y >= groupY
    && center.y <= groupY + groupHeight
  );
}

function compareCanvasNodeOrder(a, b) {
  const yDifference = toFiniteNumber(a?.y, 0) - toFiniteNumber(b?.y, 0);
  if (yDifference !== 0) {
    return yDifference;
  }

  const xDifference = toFiniteNumber(a?.x, 0) - toFiniteNumber(b?.x, 0);
  if (xDifference !== 0) {
    return xDifference;
  }

  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function findSmallestCanvasGroupForNode(nodes, candidateNode) {
  return (Array.isArray(nodes) ? nodes : [])
    .filter((node) => doesCanvasGroupContainNode(node, candidateNode))
    .sort((a, b) => (
      (Math.max(0, toFiniteNumber(a?.width, 0)) * Math.max(0, toFiniteNumber(a?.height, 0)))
      - (Math.max(0, toFiniteNumber(b?.width, 0)) * Math.max(0, toFiniteNumber(b?.height, 0)))
    ))[0] || null;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function deriveTitle(canvasName, textBlocks, markdownFiles, imageFiles = []) {
  if (textBlocks.length > 0) {
    const firstLine = textBlocks[0].text.split("\n")[0].trim();
    if (firstLine) {
      return firstLine.slice(0, 80);
    }
  }

  if (markdownFiles.length > 0) {
    return markdownFiles[0].name || markdownFiles[0].path;
  }

  if (imageFiles.length > 0) {
    return imageFiles[0].name || imageFiles[0].path;
  }

  return `${canvasName} selection`;
}

function buildCanvasSelectionPrompt(selection, userMessage, options = {}) {
  const textBlocks = Array.isArray(selection?.textBlocks)
    ? selection.textBlocks.filter((block) => String(block?.text || "").trim())
    : [];
  const markdownFiles = Array.isArray(selection?.markdownFiles)
    ? selection.markdownFiles.filter((file) => String(file?.path || "").trim())
    : [];
  const imageFiles = Array.isArray(selection?.imageFiles)
    ? selection.imageFiles.filter((file) => String(file?.path || "").trim())
    : [];
  const warnings = Array.isArray(selection?.warnings)
    ? selection.warnings.map((warning) => String(warning || "").trim()).filter(Boolean)
    : [];
  const trimmedMessage = String(userMessage || "").trim();
  const parts = [
    "You are working from an Obsidian Canvas selection. Treat the following nodes as the task context.",
  ];

  if (textBlocks.length > 0) {
    parts.push(
      textBlocks
        .map((block, index) => `Text node ${index + 1}:\n${String(block.text || "")}`)
        .join("\n\n")
    );
  }

  if (markdownFiles.length > 0) {
    parts.push("Before answering, open and read each linked markdown file from disk. Use the file contents as required context, not just the link text.");
    parts.push(
      markdownFiles
        .map((file, index) => buildMarkdownFilePromptBlock(file, index, options))
        .join("\n\n")
    );
  }

  if (imageFiles.length > 0) {
    parts.push("Selected image files are attached to this turn as image inputs. Use them as part of the Canvas context.");
    parts.push(
      imageFiles
        .map((file, index) => `Image file ${index + 1}: ${String(file.path || file.name || "Untitled")}`)
        .join("\n\n")
    );
  }

  if (warnings.length > 0) {
    parts.push(`Resolver warnings:\n- ${warnings.join("\n- ")}`);
  }

  if (trimmedMessage) {
    parts.push(trimmedMessage);
  }

  return parts.join("\n\n").trim();
}

function normalizePromptPath(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function isPathInsideDirectory(candidatePath, directoryPath) {
  const relativePath = path.relative(String(directoryPath || ""), String(candidatePath || ""));
  return relativePath === ""
    || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveMarkdownFilePromptPath(file, cwd = "") {
  const absolutePath = String(file?.absolutePath || "").trim();
  const normalizedCwd = String(cwd || "").trim();
  const relativeFilePath = normalizePromptPath(file?.path || "");
  if (absolutePath) {
    return {
      promptPath: normalizePromptPath(absolutePath),
      isDirectPath: true,
    };
  }

  if (normalizedCwd && relativeFilePath) {
    const candidateAbsolutePath = path.resolve(normalizedCwd, relativeFilePath);
    if (fs.existsSync(candidateAbsolutePath)) {
      return {
        promptPath: normalizePromptPath(candidateAbsolutePath),
        isDirectPath: true,
      };
    }
  }

  return {
    promptPath: relativeFilePath,
    isDirectPath: false,
  };
}

function buildMarkdownFilePromptBlock(file, index, options = {}) {
  const { promptPath, isDirectPath } = resolveMarkdownFilePromptPath(file, options.cwd);
  if (promptPath && isDirectPath) {
    return `Markdown file ${index + 1}: ${promptPath}`;
  }

  return `Markdown file ${index + 1}: ${String(promptPath || file?.path || file?.absolutePath || "").trim()}\n\n\`\`\`md\n${String(file?.content || "")}\n\`\`\``;
}

function buildNewThreadPromptFromSelection(selection) {
  const textBlocks = Array.isArray(selection?.textBlocks) ? selection.textBlocks : [];
  const markdownFiles = Array.isArray(selection?.markdownFiles) ? selection.markdownFiles : [];
  const imageFiles = Array.isArray(selection?.imageFiles) ? selection.imageFiles : [];
  if (textBlocks.length === 0 && markdownFiles.length > 0 && imageFiles.length === 0) {
    return buildCanvasSelectionPrompt(
      selection,
      markdownFiles.length === 1
        ? "Use the selected markdown file as the primary context and continue with the most helpful next step."
        : "Use the selected markdown files as the primary context and continue with the most helpful next step.",
      { cwd: repoRoot },
    );
  }

  if (textBlocks.length === 0 && markdownFiles.length === 0 && imageFiles.length > 0) {
    return "";
  }

  if (textBlocks.length === 0 && (markdownFiles.length > 0 || imageFiles.length > 0)) {
    return markdownFiles.length > 0 ? buildCanvasSelectionPrompt(selection, "", { cwd: repoRoot }) : "";
  }

  if (textBlocks.length !== 1) {
    throw new Error("New thread currently requires selecting exactly one text node, optionally with file context, or selecting only supported file nodes.");
  }

  const text = String(textBlocks[0]?.text || "");
  if (!text.trim()) {
    throw new Error("The selected text node is empty.");
  }

  if (markdownFiles.length > 0) {
    return buildCanvasSelectionPrompt(selection, text, { cwd: repoRoot });
  }

  return text;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
