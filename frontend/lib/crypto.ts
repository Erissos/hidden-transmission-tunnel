import type { ChatMessage, Identity, OutboundCipherMessage } from "@/lib/types";

type CipherEnvelope = Omit<OutboundCipherMessage, "type"> & { nickname: string };

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

function toArrayBuffer(view: Uint8Array): ArrayBuffer {
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

function signablePayload(nonce: string, ciphertext: string, timestamp: string): ArrayBuffer {
  return toArrayBuffer(new TextEncoder().encode(JSON.stringify({ nonce, ciphertext, timestamp })));
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return window.btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function fromBase64Buffer(value: string): ArrayBuffer {
  return toArrayBuffer(fromBase64(value));
}

async function importPrivateKey(encoded: string): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    "pkcs8",
    fromBase64Buffer(encoded),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

async function importPublicKey(encoded: string): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    "spki",
    fromBase64Buffer(encoded),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
}

export async function createIdentity(): Promise<Identity> {
  const keys = await window.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicKey = await window.crypto.subtle.exportKey("spki", keys.publicKey);
  const privateKey = await window.crypto.subtle.exportKey("pkcs8", keys.privateKey);
  const aliasBytes = window.crypto.getRandomValues(new Uint8Array(3));
  const aliasSuffix = Array.from(aliasBytes)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");

  return {
    alias: `phantom_${aliasSuffix}`,
    publicKey: toBase64(publicKey),
    privateKey: toBase64(privateKey),
  };
}

export async function deriveRoomKey(roomCode: string, roomSalt: string): Promise<CryptoKey> {
  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeRoomCode(roomCode)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64Buffer(roomSalt),
      iterations: 310000,
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMessage(
  body: string,
  roomKey: CryptoKey,
  identity: Identity,
  selfDestructSeconds?: number,
): Promise<OutboundCipherMessage> {
  const nonceBytes = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertextBuffer = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(nonceBytes) },
    roomKey,
    toArrayBuffer(new TextEncoder().encode(body)),
  );
  const nonce = toBase64(nonceBytes);
  const ciphertext = toBase64(ciphertextBuffer);
  const timestamp = new Date().toISOString();
  const signatureBytes = await window.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    await importPrivateKey(identity.privateKey),
    signablePayload(nonce, ciphertext, timestamp),
  );

  return {
    type: "ciphertext",
    nonce,
    ciphertext,
    signature: toBase64(signatureBytes),
    public_key: identity.publicKey,
    timestamp,
    self_destruct_seconds: selfDestructSeconds,
  };
}

export async function decryptMessage(envelope: CipherEnvelope, roomKey: CryptoKey, me: string): Promise<ChatMessage> {
  const verified = await window.crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    await importPublicKey(envelope.public_key),
    fromBase64Buffer(envelope.signature),
    signablePayload(envelope.nonce, envelope.ciphertext, envelope.timestamp),
  );

  let body = "[unable to decrypt]";
  let invalid = !verified;

  if (verified) {
    try {
      const plaintext = await window.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: fromBase64Buffer(envelope.nonce) },
        roomKey,
        fromBase64Buffer(envelope.ciphertext),
      );
      body = new TextDecoder().decode(plaintext);
    } catch {
      invalid = true;
    }
  }

  return {
    id: `${envelope.nickname}-${envelope.timestamp}-${envelope.nonce.slice(0, 8)}`,
    nickname: envelope.nickname,
    body,
    timestamp: envelope.timestamp,
    mine: envelope.nickname === me,
    invalid,
  };
}
