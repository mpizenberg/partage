/**
 * Cryptographic types for Partage
 */

export interface EncryptedData {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  authTag?: Uint8Array;
}

export interface UserKeypair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicKeyHash: string; // SHA-256 hash of public key, used as anonymous user ID
}

export interface SerializedKeypair {
  publicKey: string; // Base64 encoded
  privateKey: string; // Base64 encoded
  publicKeyHash: string;
}

export interface GroupKey {
  key: CryptoKey;
  version: number;
}

export interface SerializedGroupKey {
  key: string; // Base64 encoded
  version: number;
}
