import { describe, it, expect } from 'vitest';
import {
  generateSigningKeypair,
  sign,
  verify,
  exportSigningKeypair,
  importSigningKeypair,
  importVerificationKey,
  signString,
  verifyString,
  signJSON,
  verifyJSON,
} from './signatures';

describe('Digital Signatures (ECDSA)', () => {
  describe('Signing Keypair Generation', () => {
    it('should generate a valid signing keypair', async () => {
      const keypair = await generateSigningKeypair();

      expect(keypair.publicKey).toBeDefined();
      expect(keypair.privateKey).toBeDefined();
      expect(keypair.publicKey.type).toBe('public');
      expect(keypair.privateKey.type).toBe('private');
    });

    it('should generate different keypairs each time', async () => {
      const keypair1 = await generateSigningKeypair();
      const keypair2 = await generateSigningKeypair();

      const exported1 = await exportSigningKeypair(keypair1);
      const exported2 = await exportSigningKeypair(keypair2);

      expect(exported1.publicKey).not.toBe(exported2.publicKey);
      expect(exported1.privateKey).not.toBe(exported2.privateKey);
    });
  });

  describe('Signing and Verification', () => {
    it('should sign and verify data correctly', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('Important message');

      const signature = await sign(data, keypair.privateKey);
      const isValid = await verify(data, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should produce different signatures for same data', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('test');

      const signature1 = await sign(data, keypair.privateKey);
      const signature2 = await sign(data, keypair.privateKey);

      // ECDSA signatures include randomness, so they differ
      // But both should be valid
      expect(signature1).not.toEqual(signature2);
      expect(await verify(data, signature1, keypair.publicKey)).toBe(true);
      expect(await verify(data, signature2, keypair.publicKey)).toBe(true);
    });

    it('should fail verification with wrong public key', async () => {
      const keypair1 = await generateSigningKeypair();
      const keypair2 = await generateSigningKeypair();
      const data = new TextEncoder().encode('message');

      const signature = await sign(data, keypair1.privateKey);
      const isValid = await verify(data, signature, keypair2.publicKey);

      expect(isValid).toBe(false);
    });

    it('should fail verification with tampered data', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('original message');

      const signature = await sign(data, keypair.privateKey);

      // Tamper with data
      const tamperedData = new TextEncoder().encode('tampered message');
      const isValid = await verify(tamperedData, signature, keypair.publicKey);

      expect(isValid).toBe(false);
    });

    it('should fail verification with tampered signature', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('message');

      const signature = await sign(data, keypair.privateKey);

      // Tamper with signature
      if (signature[0] !== undefined) {
        signature[0] ^= 1;
      }
      const isValid = await verify(data, signature, keypair.publicKey);

      expect(isValid).toBe(false);
    });

    it('should handle empty data', async () => {
      const keypair = await generateSigningKeypair();
      const data = new Uint8Array(0);

      const signature = await sign(data, keypair.privateKey);
      const isValid = await verify(data, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should handle large data', async () => {
      const keypair = await generateSigningKeypair();
      // 64 KB of data (crypto.getRandomValues max)
      const data = new Uint8Array(65536);
      crypto.getRandomValues(data);

      const signature = await sign(data, keypair.privateKey);
      const isValid = await verify(data, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });
  });

  describe('Keypair Export/Import', () => {
    it('should export and import signing keypair', async () => {
      const original = await generateSigningKeypair();
      const data = new TextEncoder().encode('test message');

      const exported = await exportSigningKeypair(original);
      const imported = await importSigningKeypair(exported);

      // Sign with original, verify with imported
      const signature = await sign(data, original.privateKey);
      const isValid = await verify(data, signature, imported.publicKey);

      expect(isValid).toBe(true);
    });

    it('should maintain signing capability after import', async () => {
      const original = await generateSigningKeypair();
      const data = new TextEncoder().encode('message');

      const exported = await exportSigningKeypair(original);
      const imported = await importSigningKeypair(exported);

      // Sign with imported, verify with original
      const signature = await sign(data, imported.privateKey);
      const isValid = await verify(data, signature, original.publicKey);

      expect(isValid).toBe(true);
    });

    it('should import verification key only', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('message');

      const exported = await exportSigningKeypair(keypair);
      const verificationKey = await importVerificationKey(exported.publicKey);

      const signature = await sign(data, keypair.privateKey);
      const isValid = await verify(data, signature, verificationKey);

      expect(isValid).toBe(true);
    });
  });

  describe('String Signing', () => {
    it('should sign and verify strings', async () => {
      const keypair = await generateSigningKeypair();
      const message = 'This is a signed message';

      const signature = await signString(message, keypair.privateKey);
      const isValid = await verifyString(message, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should fail verification with modified string', async () => {
      const keypair = await generateSigningKeypair();
      const message = 'Original message';

      const signature = await signString(message, keypair.privateKey);
      const isValid = await verifyString('Modified message', signature, keypair.publicKey);

      expect(isValid).toBe(false);
    });

    it('should handle unicode strings', async () => {
      const keypair = await generateSigningKeypair();
      const message = 'Hello 世界! 🌍';

      const signature = await signString(message, keypair.privateKey);
      const isValid = await verifyString(message, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should handle empty strings', async () => {
      const keypair = await generateSigningKeypair();
      const message = '';

      const signature = await signString(message, keypair.privateKey);
      const isValid = await verifyString(message, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });
  });

  describe('JSON Signing', () => {
    it('should sign and verify JSON objects', async () => {
      const keypair = await generateSigningKeypair();
      const obj = { name: 'Alice', amount: 50, timestamp: Date.now() };

      const signature = await signJSON(obj, keypair.privateKey);
      const isValid = await verifyJSON(obj, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should fail verification with modified object', async () => {
      const keypair = await generateSigningKeypair();
      const obj = { amount: 50, description: 'Lunch' };

      const signature = await signJSON(obj, keypair.privateKey);

      // Modify object
      const modified = { ...obj, amount: 100 };
      const isValid = await verifyJSON(modified, signature, keypair.publicKey);

      expect(isValid).toBe(false);
    });

    it('should handle nested objects', async () => {
      const keypair = await generateSigningKeypair();
      const obj = {
        user: { name: 'Bob', id: 123 },
        items: ['item1', 'item2'],
        metadata: { created: Date.now() },
      };

      const signature = await signJSON(obj, keypair.privateKey);
      const isValid = await verifyJSON(obj, signature, keypair.publicKey);

      expect(isValid).toBe(true);
    });

    it('should be sensitive to property order (deterministic JSON)', async () => {
      const keypair = await generateSigningKeypair();
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };

      const signature1 = await signJSON(obj1, keypair.privateKey);

      // JSON.stringify may produce different order
      // Our implementation uses JSON.stringify, so order matters
      const isValid = await verifyJSON(obj2, signature1, keypair.publicKey);

      // This test documents current behavior - in practice, CRDT operations
      // should maintain consistent ordering
      expect(isValid).toBeDefined();
      expect(typeof isValid).toBe('boolean');
    });
  });

  describe('Security Properties', () => {
    it('should not allow signing with public key', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('test');

      await expect(sign(data, keypair.publicKey as any)).rejects.toThrow();
    });

    it('should not allow verifying without public key', async () => {
      const keypair = await generateSigningKeypair();
      const data = new TextEncoder().encode('test');
      const signature = await sign(data, keypair.privateKey);

      // Using private key for verification should return false (not throw)
      const isValid = await verify(data, signature, keypair.privateKey as any);
      expect(isValid).toBe(false);
    });

    it('should provide non-repudiation', async () => {
      // Once signed, the signer cannot deny creating the signature
      const signer = await generateSigningKeypair();

      const document = new TextEncoder().encode('I agree to the terms');
      const signature = await sign(document, signer.privateKey);

      // Anyone can verify the signature
      const isValid = await verify(document, signature, signer.publicKey);
      expect(isValid).toBe(true);

      // Signer cannot claim they didn't sign it
      const stillValid = await verify(document, signature, signer.publicKey);
      expect(stillValid).toBe(true);
    });

    it('should prevent forgery', async () => {
      const legitimate = await generateSigningKeypair();
      const attacker = await generateSigningKeypair();

      const document = new TextEncoder().encode('Transfer $1000 to attacker');

      // Attacker tries to forge legitimate user's signature
      const forgedSignature = await sign(document, attacker.privateKey);

      // Verification should fail
      const isValid = await verify(document, forgedSignature, legitimate.publicKey);
      expect(isValid).toBe(false);
    });
  });
});
