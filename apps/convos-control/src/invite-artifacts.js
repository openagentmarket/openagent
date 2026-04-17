import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const QR_SCRIPT_FILENAME = "openagent-convos-qrcode.swift";
const QR_IMAGE_FILENAME = "control-room-invite.png";

const QR_SWIFT_SOURCE = `
import Foundation
import CoreImage
import CoreImage.CIFilterBuiltins
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else {
  fputs("usage: qrcode.swift <text> <output>\\n", stderr)
  exit(2)
}

let text = args[1]
let output = args[2]

let context = CIContext()
let filter = CIFilter.qrCodeGenerator()
filter.message = Data(text.utf8)
filter.correctionLevel = "M"

guard let image = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 16, y: 16)) else {
  fputs("failed to build qr image\\n", stderr)
  exit(1)
}

guard let cgImage = context.createCGImage(image, from: image.extent) else {
  fputs("failed to create cg image\\n", stderr)
  exit(1)
}

let bitmap = NSBitmapImageRep(cgImage: cgImage)
guard let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("failed to encode png\\n", stderr)
  exit(1)
}

do {
  try png.write(to: URL(fileURLWithPath: output))
  print(output)
} catch {
  fputs("failed to write png: \\(error)\\n", stderr)
  exit(1)
}
`;

export function enrichControlRoomInvite(controlRoom, dataDir) {
  const inviteUrl = normalizeInviteUrl(controlRoom?.inviteUrl);
  const deepLink = toConvosDeepLink(inviteUrl);
  const qrPngPath = writeQrPng(deepLink, dataDir);

  return {
    ...controlRoom,
    inviteUrl,
    deepLink,
    qrPngPath,
  };
}

export function toConvosDeepLink(inviteUrl) {
  const slug = extractInviteSlug(inviteUrl);
  if (!slug) {
    return inviteUrl;
  }
  return `convos://join/${slug}`;
}

function extractInviteSlug(inviteUrl) {
  if (!inviteUrl) {
    return "";
  }

  try {
    const url = new URL(inviteUrl);
    const slug = url.searchParams.get("i");
    if (slug) {
      return slug;
    }
  } catch {
    if (String(inviteUrl).startsWith("convos://join/")) {
      return String(inviteUrl).slice("convos://join/".length);
    }
  }

  return "";
}

function normalizeInviteUrl(inviteUrl) {
  return typeof inviteUrl === "string" ? inviteUrl.trim() : "";
}

function writeQrPng(text, dataDir) {
  if (!text || process.platform !== "darwin") {
    return null;
  }

  const resolvedDataDir = path.resolve(dataDir);
  fs.mkdirSync(resolvedDataDir, { recursive: true });

  const scriptPath = ensureQrScript();
  const outputPath = path.join(resolvedDataDir, QR_IMAGE_FILENAME);
  const result = spawnSync("/usr/bin/swift", [scriptPath, text, outputPath], {
    encoding: "utf8",
    timeout: 30_000,
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || result.stdout?.trim() || "unknown QR rendering error";
    throw new Error(`Failed generating invite QR: ${stderr}`);
  }

  return outputPath;
}

function ensureQrScript() {
  const scriptPath = path.join(os.tmpdir(), QR_SCRIPT_FILENAME);
  if (!fs.existsSync(scriptPath) || fs.readFileSync(scriptPath, "utf8") !== QR_SWIFT_SOURCE) {
    fs.writeFileSync(scriptPath, QR_SWIFT_SOURCE, "utf8");
  }
  return scriptPath;
}
