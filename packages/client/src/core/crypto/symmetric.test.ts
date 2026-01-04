import { describe, it, expect } from 'vitest';
import {
  generateSymmetricKey,
  encrypt,
  decrypt,
  exportSymmetricKey,
  importSymmetricKey,
  encryptString,
  decryptString,
  encryptJSON,
  decryptJSON,
} from './symmetric';

describe('Symmetric Encryption (AES-256-GCM)', () => {
  describe('Key Generation', () => {
    it('should generate a valid symmetric key', async () => {
      const key = await generateSymmetricKey();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
    });

    it('should generate different keys each time', async () => {
      const key1 = await generateSymmetricKey();
      const key2 = await generateSymmetricKey();

      const exported1 = await exportSymmetricKey(key1);
      const exported2 = await exportSymmetricKey(key2);

      expect(exported1).not.toBe(exported2);
    });
  });

  describe('Encryption and Decryption', () => {
    it('should encrypt and decrypt data correctly', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('Hello, World!');

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });

    it('should produce different ciphertexts for same plaintext', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('test data');

      const encrypted1 = await encrypt(plaintext, key);
      const encrypted2 = await encrypt(plaintext, key);

      // Different IVs should produce different ciphertexts
      expect(encrypted1.ciphertext).not.toEqual(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toEqual(encrypted2.iv);

      // But both should decrypt to same plaintext
      const decrypted1 = await decrypt(encrypted1, key);
      const decrypted2 = await decrypt(encrypted2, key);
      expect(decrypted1).toEqual(plaintext);
      expect(decrypted2).toEqual(plaintext);
    });

    it('should fail decryption with wrong key', async () => {
      const key1 = await generateSymmetricKey();
      const key2 = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('secret');

      const encrypted = await encrypt(plaintext, key1);

      await expect(decrypt(encrypted, key2)).rejects.toThrow('Decryption failed');
    });

    it('should detect tampering with ciphertext', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('original data');

      const encrypted = await encrypt(plaintext, key);

      // Tamper with ciphertext
      if (encrypted.ciphertext[0] !== undefined) {
        encrypted.ciphertext[0] ^= 1;
      }

      await expect(decrypt(encrypted, key)).rejects.toThrow('Decryption failed');
    });

    it('should detect tampering with IV', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('original data');

      const encrypted = await encrypt(plaintext, key);

      // Tamper with IV
      if (encrypted.iv[0] !== undefined) {
        encrypted.iv[0] ^= 1;
      }

      await expect(decrypt(encrypted, key)).rejects.toThrow('Decryption failed');
    });

    it('should handle empty data', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new Uint8Array(0);

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
      expect(decrypted.length).toBe(0);
    });

    it('should handle large data', async () => {
      const key = await generateSymmetricKey();
      // 64 KB of data (crypto.getRandomValues max)
      const plaintext = new Uint8Array(65536);
      crypto.getRandomValues(plaintext);

      const encrypted = await encrypt(plaintext, key);
      const decrypted = await decrypt(encrypted, key);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('Key Import/Export', () => {
    it('should export and import a key correctly', async () => {
      const originalKey = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('test');

      const exported = await exportSymmetricKey(originalKey);
      const imported = await importSymmetricKey(exported);

      // Encrypt with original, decrypt with imported
      const encrypted = await encrypt(plaintext, originalKey);
      const decrypted = await decrypt(encrypted, imported);

      expect(decrypted).toEqual(plaintext);
    });

    it('should produce same export for same key', async () => {
      const key = await generateSymmetricKey();

      const exported1 = await exportSymmetricKey(key);
      const exported2 = await exportSymmetricKey(key);

      expect(exported1).toBe(exported2);
    });
  });

  describe('String Encryption', () => {
    it('should encrypt and decrypt strings', async () => {
      const key = await generateSymmetricKey();
      const message = 'This is a secret message!';

      const encrypted = await encryptString(message, key);
      const decrypted = await decryptString(encrypted, key);

      expect(decrypted).toBe(message);
    });

    it('should handle unicode strings', async () => {
      const key = await generateSymmetricKey();
      const message = 'Hello 世界! 🌍';

      const encrypted = await encryptString(message, key);
      const decrypted = await decryptString(encrypted, key);

      expect(decrypted).toBe(message);
    });

    it('should handle empty strings', async () => {
      const key = await generateSymmetricKey();
      const message = '';

      const encrypted = await encryptString(message, key);
      const decrypted = await decryptString(encrypted, key);

      expect(decrypted).toBe(message);
    });
  });

  describe('JSON Encryption', () => {
    it('should encrypt and decrypt simple objects', async () => {
      const key = await generateSymmetricKey();
      const obj = { name: 'Alice', amount: 42.5, active: true };

      const encrypted = await encryptJSON(obj, key);
      const decrypted = await decryptJSON<typeof obj>(encrypted, key);

      expect(decrypted).toEqual(obj);
    });

    it('should encrypt and decrypt nested objects', async () => {
      const key = await generateSymmetricKey();
      const obj = {
        user: { name: 'Bob', id: 123 },
        items: ['apple', 'banana'],
        metadata: { created: Date.now(), tags: ['tag1', 'tag2'] },
      };

      const encrypted = await encryptJSON(obj, key);
      const decrypted = await decryptJSON<typeof obj>(encrypted, key);

      expect(decrypted).toEqual(obj);
    });

    it('should handle arrays', async () => {
      const key = await generateSymmetricKey();
      const arr = [1, 2, 3, { x: 'test' }];

      const encrypted = await encryptJSON(arr, key);
      const decrypted = await decryptJSON<typeof arr>(encrypted, key);

      expect(decrypted).toEqual(arr);
    });

    it('should handle null and undefined in objects', async () => {
      const key = await generateSymmetricKey();
      const obj = { a: null, b: undefined, c: 'value' };

      const encrypted = await encryptJSON(obj, key);
      const decrypted = await decryptJSON<typeof obj>(encrypted, key);

      // Note: JSON.stringify removes undefined, so it won't be in decrypted
      expect(decrypted.a).toBe(null);
      expect(decrypted.c).toBe('value');
      expect('b' in decrypted).toBe(false);
    });
  });

  describe('Security Properties', () => {
    it('should use unique IV for each encryption', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('test');

      const ivs = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const encrypted = await encrypt(plaintext, key);
        const ivString = Array.from(encrypted.iv).join(',');
        expect(ivs.has(ivString)).toBe(false);
        ivs.add(ivString);
      }
    });

    it('should produce IV of correct length (12 bytes for GCM)', async () => {
      const key = await generateSymmetricKey();
      const plaintext = new TextEncoder().encode('test');

      const encrypted = await encrypt(plaintext, key);
      expect(encrypted.iv.length).toBe(12);
    });
  });
});
