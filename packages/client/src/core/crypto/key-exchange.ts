/**
 * Key exchange protocol for sharing group keys with new members
 * Uses ECDH for key agreement + AES-GCM for encryption + ECDSA for signatures
 */

import type { GroupKeysPayload, EncryptedGroupKeys } from '@partage/shared';
import { deriveSharedKey, importPublicKey } from './keypair.js';
import { encrypt, decrypt } from './symmetric.js';
import { sign, verify, importVerificationKey } from './signatures.js';

/**
 * Encrypt group keys for a specific recipient using their public key
 * Uses ECDH to derive a shared secret, then AES-GCM to encrypt the payload
 *
 * @param payload - Group keys to encrypt
 * @param recipientPublicKeyBase64 - Recipient's public key (Base64)
 * @param senderPrivateKey - Sender's private key (for ECDH)
 * @returns Encrypted keys (iv, ciphertext as Base64 strings)
 */
export async function encryptGroupKeysForRecipient(
  payload: GroupKeysPayload,
  recipientPublicKeyBase64: string,
  senderPrivateKey: CryptoKey
): Promise<EncryptedGroupKeys> {
  // Import recipient's public key
  const recipientPublicKey = await importPublicKey(recipientPublicKeyBase64);

  // Derive shared secret using ECDH
  const sharedKey = await deriveSharedKey(senderPrivateKey, recipientPublicKey);

  // Serialize the payload to JSON
  const payloadJSON = JSON.stringify(payload);
  const payloadData = new TextEncoder().encode(payloadJSON);

  // Encrypt with the shared key
  const encrypted = await encrypt(payloadData, sharedKey);

  // Convert Uint8Arrays to Base64 for JSON serialization
  return {
    iv: btoa(String.fromCharCode(...encrypted.iv)),
    ciphertext: btoa(String.fromCharCode(...encrypted.ciphertext)),
  };
}

/**
 * Decrypt group keys received from a sender
 * Uses ECDH to derive the same shared secret, then AES-GCM to decrypt
 *
 * @param encryptedKeys - Encrypted keys to decrypt (Base64 strings)
 * @param senderPublicKeyBase64 - Sender's public key (Base64)
 * @param recipientPrivateKey - Recipient's private key (for ECDH)
 * @returns Decrypted group keys payload
 */
export async function decryptGroupKeysFromSender(
  encryptedKeys: EncryptedGroupKeys,
  senderPublicKeyBase64: string,
  recipientPrivateKey: CryptoKey
): Promise<GroupKeysPayload> {
  // Import sender's public key
  const senderPublicKey = await importPublicKey(senderPublicKeyBase64);

  // Derive shared secret using ECDH (same secret as sender derived)
  const sharedKey = await deriveSharedKey(recipientPrivateKey, senderPublicKey);

  // Convert Base64 strings back to Uint8Arrays
  const iv = Uint8Array.from(atob(encryptedKeys.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(encryptedKeys.ciphertext), (c) => c.charCodeAt(0));

  // Decrypt with the shared key
  const decryptedData = await decrypt({ iv, ciphertext }, sharedKey);

  // Parse JSON payload
  const payloadJSON = new TextDecoder().decode(decryptedData);
  return JSON.parse(payloadJSON) as GroupKeysPayload;
}

/**
 * Sign encrypted key package for authenticity and integrity
 * Creates an ECDSA signature over the encrypted data
 *
 * @param encryptedKeys - Encrypted keys to sign
 * @param signingPrivateKey - Sender's signing private key
 * @returns Base64 signature
 */
export async function signKeyPackage(
  encryptedKeys: EncryptedGroupKeys,
  signingPrivateKey: CryptoKey
): Promise<string> {
  // Serialize the encrypted keys to canonical format
  const data = JSON.stringify({
    iv: encryptedKeys.iv,
    ciphertext: encryptedKeys.ciphertext,
  });

  const dataBytes = new TextEncoder().encode(data);
  const signature = await sign(dataBytes, signingPrivateKey);

  return btoa(String.fromCharCode(...signature));
}

/**
 * Verify signature on encrypted key package
 * Ensures the package hasn't been tampered with and comes from expected sender
 *
 * @param encryptedKeys - Encrypted keys to verify
 * @param signatureBase64 - Base64 signature to verify
 * @param senderVerificationKeyBase64 - Sender's verification public key (Base64)
 * @returns true if signature is valid
 */
export async function verifyKeyPackage(
  encryptedKeys: EncryptedGroupKeys,
  signatureBase64: string,
  senderVerificationKeyBase64: string
): Promise<boolean> {
  // Serialize the encrypted keys to same canonical format used for signing
  const data = JSON.stringify({
    iv: encryptedKeys.iv,
    ciphertext: encryptedKeys.ciphertext,
  });

  const dataBytes = new TextEncoder().encode(data);
  const signature = Uint8Array.from(atob(signatureBase64), (c) => c.charCodeAt(0));

  // Import sender's verification key
  const verificationKey = await importVerificationKey(senderVerificationKeyBase64);

  return await verify(dataBytes, signature, verificationKey);
}

/**
 * Create a complete key package for a new member
 * Encrypts group keys and creates a signature for authenticity
 *
 * @param payload - Group keys to share
 * @param recipientPublicKeyBase64 - Recipient's public key
 * @param senderPrivateKey - Sender's private key (for ECDH)
 * @param senderSigningPrivateKey - Sender's signing private key
 * @returns Encrypted keys and signature
 */
export async function createKeyPackage(
  payload: GroupKeysPayload,
  recipientPublicKeyBase64: string,
  senderPrivateKey: CryptoKey,
  senderSigningPrivateKey: CryptoKey
): Promise<{ encryptedKeys: EncryptedGroupKeys; signature: string }> {
  // Encrypt the keys
  const encryptedKeys = await encryptGroupKeysForRecipient(
    payload,
    recipientPublicKeyBase64,
    senderPrivateKey
  );

  // Sign the encrypted package
  const signature = await signKeyPackage(encryptedKeys, senderSigningPrivateKey);

  return { encryptedKeys, signature };
}

/**
 * Verify and decrypt a received key package
 * Checks signature first, then decrypts if valid
 *
 * @param encryptedKeys - Encrypted keys received
 * @param signature - Signature to verify
 * @param senderPublicKeyBase64 - Sender's public key (for ECDH)
 * @param senderVerificationKeyBase64 - Sender's verification key (for signature)
 * @param recipientPrivateKey - Recipient's private key (for ECDH)
 * @returns Decrypted group keys payload, or throws if signature invalid
 */
export async function verifyAndDecryptKeyPackage(
  encryptedKeys: EncryptedGroupKeys,
  signature: string,
  senderPublicKeyBase64: string,
  senderVerificationKeyBase64: string,
  recipientPrivateKey: CryptoKey
): Promise<GroupKeysPayload> {
  // Verify signature first
  const isValid = await verifyKeyPackage(
    encryptedKeys,
    signature,
    senderVerificationKeyBase64
  );

  if (!isValid) {
    throw new Error('Invalid key package signature');
  }

  // Decrypt if signature is valid
  return await decryptGroupKeysFromSender(
    encryptedKeys,
    senderPublicKeyBase64,
    recipientPrivateKey
  );
}
