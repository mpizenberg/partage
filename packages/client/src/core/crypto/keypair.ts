/**
 * Keypair generation and management for user identity
 * Uses ECDH P-256 for key agreement and ECDSA for signatures
 */

import { CRYPTO_CONFIG } from '@partage/shared';
import type { UserKeypair, SerializedKeypair } from '@partage/shared';

/**
 * Generate a new ECDH keypair for user identity
 * This keypair is used for key exchange and digital signatures
 * @returns UserKeypair with public/private keys and public key hash
 */
export async function generateKeypair(): Promise<UserKeypair> {
  // Generate ECDH keypair for key agreement
  const keypair = await crypto.subtle.generateKey(
    {
      name: CRYPTO_CONFIG.ASYMMETRIC_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true, // extractable
    ['deriveKey', 'deriveBits']
  );

  // Generate public key hash for anonymous identification
  const publicKeyHash = await hashPublicKey(keypair.publicKey);

  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.privateKey,
    publicKeyHash,
  };
}

/**
 * Hash a public key to create an anonymous user identifier
 * @param publicKey - CryptoKey to hash
 * @returns Hex string of SHA-256 hash
 */
export async function hashPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', publicKey);
  const hashBuffer = await crypto.subtle.digest(CRYPTO_CONFIG.HASH_ALGORITHM, exported);
  return arrayBufferToHex(hashBuffer);
}

/**
 * Export a keypair to a format that can be stored or transferred
 * @param keypair - UserKeypair to export
 * @returns SerializedKeypair with Base64-encoded keys
 */
export async function exportKeypair(keypair: UserKeypair): Promise<SerializedKeypair> {
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);

  return {
    publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer))),
    privateKey: btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer))),
    publicKeyHash: keypair.publicKeyHash,
  };
}

/**
 * Import a keypair from serialized format
 * @param serialized - SerializedKeypair with Base64-encoded keys
 * @returns UserKeypair ready for use
 */
export async function importKeypair(serialized: SerializedKeypair): Promise<UserKeypair> {
  const publicKeyData = Uint8Array.from(atob(serialized.publicKey), (c) => c.charCodeAt(0));
  const privateKeyData = Uint8Array.from(atob(serialized.privateKey), (c) => c.charCodeAt(0));

  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyData,
    {
      name: CRYPTO_CONFIG.ASYMMETRIC_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    []
  );

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyData,
    {
      name: CRYPTO_CONFIG.ASYMMETRIC_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    ['deriveKey', 'deriveBits']
  );

  return {
    publicKey,
    privateKey,
    publicKeyHash: serialized.publicKeyHash,
  };
}

/**
 * Import only a public key (for verifying others' signatures)
 * @param publicKeyString - Base64-encoded public key
 * @returns CryptoKey for verification
 */
export async function importPublicKey(publicKeyString: string): Promise<CryptoKey> {
  const publicKeyData = Uint8Array.from(atob(publicKeyString), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    'raw',
    publicKeyData,
    {
      name: CRYPTO_CONFIG.ASYMMETRIC_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    []
  );
}

/**
 * Export only a public key (for sharing with others)
 * @param publicKey - CryptoKey to export
 * @returns Base64-encoded public key string
 */
export async function exportPublicKey(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

/**
 * Derive a shared secret from your private key and another's public key
 * This is used for encrypting data specifically for one recipient
 * @param privateKey - Your private key
 * @param publicKey - Other party's public key
 * @returns Shared symmetric key for encryption
 */
export async function deriveSharedKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey
): Promise<CryptoKey> {
  const sharedSecret = await crypto.subtle.deriveKey(
    {
      name: CRYPTO_CONFIG.ASYMMETRIC_ALGORITHM,
      public: publicKey,
    },
    privateKey,
    {
      name: CRYPTO_CONFIG.SYMMETRIC_ALGORITHM,
      length: CRYPTO_CONFIG.SYMMETRIC_KEY_LENGTH,
    },
    false, // not extractable
    ['encrypt', 'decrypt']
  );

  return sharedSecret;
}

// Helper functions

function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
