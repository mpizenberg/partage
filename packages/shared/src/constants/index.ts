export const CRYPTO_CONFIG = {
  SYMMETRIC_ALGORITHM: 'AES-GCM' as const,
  SYMMETRIC_KEY_LENGTH: 256,
  ASYMMETRIC_ALGORITHM: 'ECDH' as const,
  ASYMMETRIC_CURVE: 'P-256' as const,
  SIGNATURE_ALGORITHM: 'ECDSA' as const,
  HASH_ALGORITHM: 'SHA-256' as const,
} as const;

export const STORAGE_CONFIG = {
  DB_NAME: 'partage-db',
  DB_VERSION: 1,
} as const;
