/**
 * Symmetric encryption using AES-256-GCM
 * Uses WebCrypto API for secure, browser-native encryption
 */

import { CRYPTO_CONFIG } from '@partage/shared';
import type { EncryptedData } from '@partage/shared';

/**
 * Generate a new symmetric key for AES-256-GCM encryption
 * @returns CryptoKey that can be used for encryption/decryption
 */
export async function generateSymmetricKey(): Promise<CryptoKey> {
  return await crypto.subtle.generateKey(
    {
      name: CRYPTO_CONFIG.SYMMETRIC_ALGORITHM,
      length: CRYPTO_CONFIG.SYMMETRIC_KEY_LENGTH,
    },
    true, // extractable (so we can export it)
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-256-GCM
 * @param data - Data to encrypt
 * @param key - Symmetric encryption key
 * @returns Encrypted data with IV and auth tag
 */
export async function encrypt(data: Uint8Array, key: CryptoKey): Promise<EncryptedData> {
  // Generate random IV (12 bytes is standard for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the data
  const encryptedBuffer = await crypto.subtle.encrypt(
    {
      name: CRYPTO_CONFIG.SYMMETRIC_ALGORITHM,
      iv,
    },
    key,
    data as BufferSource
  );

  // GCM mode includes authentication tag at the end of ciphertext
  const ciphertext = new Uint8Array(encryptedBuffer);

  return {
    ciphertext,
    iv,
  };
}

/**
 * Decrypt data using AES-256-GCM
 * @param encrypted - Encrypted data with IV
 * @param key - Symmetric decryption key
 * @returns Decrypted plaintext data
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decrypt(encrypted: EncryptedData, key: CryptoKey): Promise<Uint8Array> {
  try {
    const decryptedBuffer = await crypto.subtle.decrypt(
      {
        name: CRYPTO_CONFIG.SYMMETRIC_ALGORITHM,
        iv: encrypted.iv as BufferSource,
      },
      key,
      encrypted.ciphertext as BufferSource
    );

    return new Uint8Array(decryptedBuffer);
  } catch {
    throw new Error('Decryption failed: Invalid key or corrupted data');
  }
}

/**
 * Export a symmetric key to a format that can be stored
 * @param key - CryptoKey to export
 * @returns Base64-encoded key string
 */
export async function exportSymmetricKey(key: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

/**
 * Import a symmetric key from stored format
 * @param keyString - Base64-encoded key string
 * @returns CryptoKey for encryption/decryption
 */
export async function importSymmetricKey(keyString: string): Promise<CryptoKey> {
  const keyData = Uint8Array.from(atob(keyString), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    'raw',
    keyData,
    {
      name: CRYPTO_CONFIG.SYMMETRIC_ALGORITHM,
      length: CRYPTO_CONFIG.SYMMETRIC_KEY_LENGTH,
    },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * Utility: Encrypt a string (convenience wrapper)
 * @param plaintext - String to encrypt
 * @param key - Symmetric encryption key
 * @returns Encrypted data
 */
export async function encryptString(plaintext: string, key: CryptoKey): Promise<EncryptedData> {
  const data = new TextEncoder().encode(plaintext);
  return await encrypt(data, key);
}

/**
 * Utility: Decrypt to a string (convenience wrapper)
 * @param encrypted - Encrypted data
 * @param key - Symmetric decryption key
 * @returns Decrypted string
 */
export async function decryptString(encrypted: EncryptedData, key: CryptoKey): Promise<string> {
  const data = await decrypt(encrypted, key);
  return new TextDecoder().decode(data);
}

/**
 * Utility: Encrypt an object as JSON
 * @param obj - Object to encrypt
 * @param key - Symmetric encryption key
 * @returns Encrypted data
 */
export async function encryptJSON<T>(obj: T, key: CryptoKey): Promise<EncryptedData> {
  const json = JSON.stringify(obj);
  return await encryptString(json, key);
}

/**
 * Utility: Decrypt JSON object
 * @param encrypted - Encrypted data
 * @param key - Symmetric decryption key
 * @returns Decrypted and parsed object
 */
export async function decryptJSON<T>(encrypted: EncryptedData, key: CryptoKey): Promise<T> {
  const json = await decryptString(encrypted, key);
  return JSON.parse(json);
}
