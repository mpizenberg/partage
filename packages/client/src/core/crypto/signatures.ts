/**
 * Digital signatures using ECDSA
 * Provides authentication and integrity verification for all operations
 */

import { CRYPTO_CONFIG } from '@partage/shared';

/**
 * Generate a signing keypair (ECDSA)
 * Separate from ECDH keypair used for key agreement
 * @returns CryptoKeyPair for signing and verification
 */
export async function generateSigningKeypair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: CRYPTO_CONFIG.SIGNATURE_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    ['sign', 'verify']
  );
}

/**
 * Sign data with a private key
 * Creates a digital signature that proves authenticity
 * @param data - Data to sign
 * @param privateKey - Signing private key
 * @returns Signature as Uint8Array
 */
export async function sign(data: Uint8Array, privateKey: CryptoKey): Promise<Uint8Array> {
  const signature = await crypto.subtle.sign(
    {
      name: CRYPTO_CONFIG.SIGNATURE_ALGORITHM,
      hash: { name: CRYPTO_CONFIG.HASH_ALGORITHM },
    },
    privateKey,
    data as BufferSource
  );

  return new Uint8Array(signature);
}

/**
 * Verify a signature with a public key
 * Confirms that data was signed by holder of corresponding private key
 * @param data - Original data that was signed
 * @param signature - Signature to verify
 * @param publicKey - Public key for verification
 * @returns true if signature is valid, false otherwise
 */
export async function verify(
  data: Uint8Array,
  signature: Uint8Array,
  publicKey: CryptoKey
): Promise<boolean> {
  try {
    return await crypto.subtle.verify(
      {
        name: CRYPTO_CONFIG.SIGNATURE_ALGORITHM,
        hash: { name: CRYPTO_CONFIG.HASH_ALGORITHM },
      },
      publicKey,
      signature as BufferSource,
      data as BufferSource
    );
  } catch {
    // If verification throws (e.g., invalid key), treat as failed verification
    return false;
  }
}

/**
 * Export a signing keypair to storable format
 * @param keypair - CryptoKeyPair to export
 * @returns Object with Base64-encoded public and private keys
 */
export async function exportSigningKeypair(keypair: CryptoKeyPair): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const publicKeyBuffer = await crypto.subtle.exportKey('raw', keypair.publicKey);
  const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);

  return {
    publicKey: btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer))),
    privateKey: btoa(String.fromCharCode(...new Uint8Array(privateKeyBuffer))),
  };
}

/**
 * Import a signing keypair from serialized format
 * @param serialized - Object with Base64-encoded keys
 * @returns CryptoKeyPair ready for signing/verification
 */
export async function importSigningKeypair(serialized: {
  publicKey: string;
  privateKey: string;
}): Promise<CryptoKeyPair> {
  const publicKeyData = Uint8Array.from(atob(serialized.publicKey), (c) => c.charCodeAt(0));
  const privateKeyData = Uint8Array.from(atob(serialized.privateKey), (c) => c.charCodeAt(0));

  const publicKey = await crypto.subtle.importKey(
    'raw',
    publicKeyData,
    {
      name: CRYPTO_CONFIG.SIGNATURE_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    ['verify']
  );

  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyData,
    {
      name: CRYPTO_CONFIG.SIGNATURE_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    ['sign']
  );

  return { publicKey, privateKey };
}

/**
 * Import only a public key for signature verification
 * @param publicKeyString - Base64-encoded public key
 * @returns CryptoKey for verification
 */
export async function importVerificationKey(publicKeyString: string): Promise<CryptoKey> {
  const publicKeyData = Uint8Array.from(atob(publicKeyString), (c) => c.charCodeAt(0));

  return await crypto.subtle.importKey(
    'raw',
    publicKeyData,
    {
      name: CRYPTO_CONFIG.SIGNATURE_ALGORITHM,
      namedCurve: CRYPTO_CONFIG.ASYMMETRIC_CURVE,
    },
    true,
    ['verify']
  );
}

/**
 * Utility: Sign a string
 * @param message - String to sign
 * @param privateKey - Signing private key
 * @returns Signature as Base64 string
 */
export async function signString(message: string, privateKey: CryptoKey): Promise<string> {
  const data = new TextEncoder().encode(message);
  const signature = await sign(data, privateKey);
  return btoa(String.fromCharCode(...signature));
}

/**
 * Utility: Verify a string signature
 * @param message - Original string
 * @param signatureString - Base64-encoded signature
 * @param publicKey - Public key for verification
 * @returns true if signature is valid
 */
export async function verifyString(
  message: string,
  signatureString: string,
  publicKey: CryptoKey
): Promise<boolean> {
  const data = new TextEncoder().encode(message);
  const signature = Uint8Array.from(atob(signatureString), (c) => c.charCodeAt(0));
  return await verify(data, signature, publicKey);
}

/**
 * Utility: Sign JSON data
 * @param obj - Object to sign
 * @param privateKey - Signing private key
 * @returns Signature as Base64 string
 */
export async function signJSON<T>(obj: T, privateKey: CryptoKey): Promise<string> {
  const json = JSON.stringify(obj);
  return await signString(json, privateKey);
}

/**
 * Utility: Verify JSON data signature
 * @param obj - Object to verify
 * @param signatureString - Base64-encoded signature
 * @param publicKey - Public key for verification
 * @returns true if signature is valid
 */
export async function verifyJSON<T>(
  obj: T,
  signatureString: string,
  publicKey: CryptoKey
): Promise<boolean> {
  const json = JSON.stringify(obj);
  return await verifyString(json, signatureString, publicKey);
}
