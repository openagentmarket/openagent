import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import protobuf from "protobufjs";
import { hexToBytes as viemHexToBytes } from "viem";
import { sign as viemSign } from "viem/accounts";

const APP_DATA_LIMIT = 8 * 1024;
const COMPRESSION_MARKER = 0x1f;
const FORMAT_VERSION = 1;
const HKDF_SALT = Buffer.from("ConvosInviteV1", "utf-8");

const root = new protobuf.Root();

const EncryptedImageRefType = new protobuf.Type("EncryptedImageRef")
  .add(new protobuf.Field("url", 1, "string"))
  .add(new protobuf.Field("salt", 2, "bytes"))
  .add(new protobuf.Field("nonce", 3, "bytes"));

const ConversationProfileType = new protobuf.Type("ConversationProfile")
  .add(new protobuf.Field("inboxId", 1, "bytes"))
  .add(new protobuf.Field("name", 2, "string", "optional"))
  .add(new protobuf.Field("image", 3, "string", "optional"))
  .add(new protobuf.Field("encryptedImage", 4, "EncryptedImageRef", "optional"));

const ConversationCustomMetadataType = new protobuf.Type("ConversationCustomMetadata")
  .add(new protobuf.Field("tag", 1, "string"))
  .add(new protobuf.Field("profiles", 2, "ConversationProfile", "repeated"))
  .add(new protobuf.Field("expiresAtUnix", 3, "sfixed64", "optional"))
  .add(new protobuf.Field("imageEncryptionKey", 4, "bytes", "optional"))
  .add(new protobuf.Field("encryptedGroupImage", 5, "EncryptedImageRef", "optional"))
  .add(new protobuf.Field("emoji", 6, "string", "optional"));

const InvitePayloadType = new protobuf.Type("InvitePayload")
  .add(new protobuf.Field("conversationToken", 1, "bytes"))
  .add(new protobuf.Field("creatorInboxId", 2, "bytes"))
  .add(new protobuf.Field("tag", 3, "string"))
  .add(new protobuf.Field("name", 4, "string", "optional"))
  .add(new protobuf.Field("description_p", 5, "string", "optional"))
  .add(new protobuf.Field("imageURL", 6, "string", "optional"))
  .add(new protobuf.Field("conversationExpiresAtUnix", 7, "sfixed64", "optional"))
  .add(new protobuf.Field("expiresAtUnix", 8, "sfixed64", "optional"))
  .add(new protobuf.Field("expiresAfterUse", 9, "bool"))
  .add(new protobuf.Field("emoji", 10, "string", "optional"));

const SignedInviteType = new protobuf.Type("SignedInvite")
  .add(new protobuf.Field("payload", 1, "bytes"))
  .add(new protobuf.Field("signature", 2, "bytes"));

ConversationCustomMetadataType.add(ConversationProfileType);
root.add(EncryptedImageRefType);
root.add(ConversationProfileType);
root.add(ConversationCustomMetadataType);
root.add(InvitePayloadType);
root.add(SignedInviteType);

export async function createCompatibleInviteUrl(runtime, conversation, options) {
  const group = runtime.convos.group(conversation);
  const existingMetadata = parseAppData(conversation.appData || "");
  let inviteTag = String(existingMetadata.tag || "").trim();

  if (!inviteTag) {
    inviteTag = randomAlphanumeric(10);
    const nextMetadata = {
      ...existingMetadata,
      tag: inviteTag,
      profiles: Array.isArray(existingMetadata.profiles) ? existingMetadata.profiles : [],
    };
    await group.inner.updateAppData(serializeAppData(nextMetadata));
  }

  const privateKey = loadWalletPrivateKey(options.dataDir);
  const slug = await createInviteSlug({
    conversationId: group.id,
    creatorInboxId: runtime.inboxId,
    inviteTag,
    walletPrivateKey: privateKey,
    options: {
      name: options.name,
      description: options.description,
      emoji: existingMetadata.emoji,
    },
  });

  return `${inviteBaseUrl(options.env)}?i=${encodeURIComponent(slug)}`;
}

function inviteBaseUrl(env) {
  return env === "production"
    ? "https://popup.convos.org/v2"
    : "https://dev.convos.org/v2";
}

function loadWalletPrivateKey(dataDir) {
  const statePath = path.join(dataDir, "agent.json");
  const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const privateKey = String(raw?.privateKey || "").trim();
  if (!privateKey) {
    throw new Error(`Missing privateKey in ${statePath}`);
  }
  return privateKey;
}

function randomAlphanumeric(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = randomBytes(length);
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[bytes[index] % alphabet.length];
  }
  return value;
}

function parseAppData(appData) {
  if (!appData || appData.length === 0) {
    return { tag: "", profiles: [] };
  }

  if (appData.startsWith("{")) {
    try {
      const parsed = JSON.parse(appData);
      return {
        tag: parsed.tag || "",
        profiles: [],
        expiresAtUnix: parsed.expiresAtUnix,
        emoji: parsed.emoji || undefined,
      };
    } catch {
      return { tag: "", profiles: [] };
    }
  }

  try {
    const rawBytes = base64urlDecode(appData);
    const decompressed = decompressIfNeeded(rawBytes);
    const message = ConversationCustomMetadataType.decode(decompressed);
    const object = ConversationCustomMetadataType.toObject(message, {
      longs: Number,
      bytes: Buffer,
      defaults: false,
    });

    return {
      tag: String(object.tag || ""),
      profiles: Array.isArray(object.profiles) ? object.profiles : [],
      expiresAtUnix: Number.isFinite(object.expiresAtUnix) && object.expiresAtUnix !== 0
        ? object.expiresAtUnix
        : undefined,
      imageEncryptionKey: object.imageEncryptionKey || undefined,
      encryptedGroupImage: object.encryptedGroupImage || undefined,
      emoji: object.emoji || undefined,
    };
  } catch {
    return { tag: "", profiles: [] };
  }
}

function serializeAppData(metadata) {
  const payload = {
    tag: metadata.tag,
    profiles: Array.isArray(metadata.profiles) ? metadata.profiles : [],
    expiresAtUnix: metadata.expiresAtUnix,
    imageEncryptionKey: metadata.imageEncryptionKey,
    encryptedGroupImage: metadata.encryptedGroupImage,
    emoji: metadata.emoji,
  };

  const errMsg = ConversationCustomMetadataType.verify(payload);
  if (errMsg) {
    throw new Error(`Invalid metadata: ${errMsg}`);
  }

  const bytes = Buffer.from(
    ConversationCustomMetadataType.encode(
      ConversationCustomMetadataType.create(payload),
    ).finish(),
  );
  const compressed = compressIfSmaller(bytes);
  const encoded = base64urlEncode(compressed);

  if (Buffer.byteLength(encoded, "utf8") > APP_DATA_LIMIT) {
    throw new Error(`Metadata exceeds ${APP_DATA_LIMIT} byte limit`);
  }

  return encoded;
}

async function createInviteSlug(input) {
  const privateKeyBytes = hexToBytes(input.walletPrivateKey);
  const creatorInboxIdBytes = hexToBytes(input.creatorInboxId);
  const conversationToken = encryptConversationToken(
    input.conversationId,
    input.creatorInboxId,
    privateKeyBytes,
  );

  const payloadObj = {
    conversationToken,
    creatorInboxId: creatorInboxIdBytes,
    tag: input.inviteTag,
    expiresAfterUse: input.options?.expiresAfterUse ?? false,
    ...(input.options?.name ? { name: input.options.name } : {}),
    ...(input.options?.description ? { description_p: input.options.description } : {}),
    ...(input.options?.imageUrl ? { imageURL: input.options.imageUrl } : {}),
    ...(input.options?.emoji ? { emoji: input.options.emoji } : {}),
    ...(input.options?.expiresAt ? { expiresAtUnix: Math.floor(input.options.expiresAt.getTime() / 1000) } : {}),
  };

  const errMsg = InvitePayloadType.verify(payloadObj);
  if (errMsg) {
    throw new Error(`Invalid invite payload: ${errMsg}`);
  }

  const payloadBytes = Buffer.from(
    InvitePayloadType.encode(InvitePayloadType.create(payloadObj)).finish(),
  );
  const messageHash = sha256(payloadBytes);
  const signature = await signWithRecovery(messageHash, input.walletPrivateKey);
  const signedInviteBytes = Buffer.from(
    SignedInviteType.encode(
      SignedInviteType.create({
        payload: payloadBytes,
        signature,
      }),
    ).finish(),
  );

  return insertSeparators(base64urlEncode(compressIfSmaller(signedInviteBytes)), "*", 300);
}

function hkdfSha256(ikm, salt, info, length) {
  const prk = createHmac("sha256", salt).update(ikm).digest();
  let previous = Buffer.alloc(0);
  let output = Buffer.alloc(0);

  for (let counter = 1; output.length < length; counter += 1) {
    previous = createHmac("sha256", prk)
      .update(Buffer.concat([previous, info, Buffer.from([counter])]))
      .digest();
    output = Buffer.concat([output, previous]);
  }

  return output.subarray(0, length);
}

function deriveTokenKey(privateKeyBytes, inboxId) {
  const info = Buffer.from(`inbox:${inboxId}`, "utf8");
  return hkdfSha256(privateKeyBytes, HKDF_SALT, info, 32);
}

function encryptConversationToken(conversationId, creatorInboxId, privateKeyBytes) {
  const key = deriveTokenKey(privateKeyBytes, creatorInboxId);
  const plaintext = packConversationId(conversationId);
  const nonce = randomBytes(12);
  const aad = Buffer.from(creatorInboxId, "utf8");
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = cipher.update(plaintext);
  cipher.final();
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([FORMAT_VERSION]), nonce, ciphertext, authTag]);
}

function packConversationId(conversationId) {
  const uuidMatch = conversationId.match(
    /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})$/i,
  );
  if (uuidMatch) {
    return Buffer.concat([Buffer.from([0x01]), Buffer.from(uuidMatch.slice(1).join(""), "hex")]);
  }

  const stringBytes = Buffer.from(conversationId, "utf8");
  if (stringBytes.length <= 255) {
    return Buffer.concat([Buffer.from([0x02, stringBytes.length]), stringBytes]);
  }

  return Buffer.concat([
    Buffer.from([0x02, 0x00, (stringBytes.length >> 8) & 0xff, stringBytes.length & 0xff]),
    stringBytes,
  ]);
}

async function signWithRecovery(messageHash, walletPrivateKey) {
  const hashHex = `0x${Buffer.from(messageHash).toString("hex")}`;
  const keyHex = walletPrivateKey.startsWith("0x") ? walletPrivateKey : `0x${walletPrivateKey}`;
  const signature = await viemSign({
    hash: hashHex,
    privateKey: keyHex,
  });

  const rBytes = Buffer.from(viemHexToBytes(signature.r));
  const sBytes = Buffer.from(viemHexToBytes(signature.s));
  const result = Buffer.alloc(65);
  rBytes.copy(result, 32 - rBytes.length);
  sBytes.copy(result, 64 - sBytes.length);
  result[64] = signature.yParity ?? 0;
  return result;
}

function sha256(data) {
  return createHash("sha256").update(data).digest();
}

function compressIfSmaller(data) {
  if (data.length <= 100) {
    return data;
  }
  const compressed = deflateSync(data);
  if (compressed.length + 5 < data.length) {
    const sizeBytes = Buffer.alloc(4);
    sizeBytes.writeUInt32BE(data.length);
    return Buffer.concat([Buffer.from([COMPRESSION_MARKER]), sizeBytes, compressed]);
  }
  return data;
}

function decompressIfNeeded(data) {
  if (data[0] === COMPRESSION_MARKER) {
    return Buffer.from(inflateSync(data.subarray(5)));
  }
  return data;
}

function insertSeparators(value, separator, every) {
  if (value.length <= every) {
    return value;
  }
  const parts = [];
  for (let index = 0; index < value.length; index += every) {
    parts.push(value.slice(index, index + every));
  }
  return parts.join(separator);
}

function base64urlEncode(data) {
  return data.toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(value, "base64url");
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  return Buffer.from(clean, "hex");
}
