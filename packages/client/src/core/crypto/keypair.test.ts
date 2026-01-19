import { describe, it, expect } from 'vitest';
import {
  generateKeypair,
  hashPublicKey,
  exportKeypair,
  importKeypair,
  exportPublicKey,
  importPublicKey,
  deriveSharedKey,
} from './keypair';
import { encrypt, decrypt } from './symmetric';

describe('Keypair Management (ECDH P-256)', () => {
  describe('Keypair Generation', () => {
    it('should generate a valid keypair', async () => {
      const keypair = await generateKeypair();

      expect(keypair.publicKey).toBeDefined();
      expect(keypair.privateKey).toBeDefined();
      expect(keypair.publicKeyHash).toBeDefined();
      expect(keypair.publicKeyHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    });

    it('should generate different keypairs each time', async () => {
      const keypair1 = await generateKeypair();
      const keypair2 = await generateKeypair();

      expect(keypair1.publicKeyHash).not.toBe(keypair2.publicKeyHash);
    });

    it('should generate consistent hash for same public key', async () => {
      const keypair = await generateKeypair();

      const hash1 = await hashPublicKey(keypair.publicKey);
      const hash2 = await hashPublicKey(keypair.publicKey);

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(keypair.publicKeyHash);
    });
  });

  describe('Keypair Export/Import', () => {
    it('should export and import a keypair', async () => {
      const original = await generateKeypair();

      const exported = await exportKeypair(original);
      const imported = await importKeypair(exported);

      expect(imported.publicKeyHash).toBe(original.publicKeyHash);

      // Verify by hashing public key again
      const importedHash = await hashPublicKey(imported.publicKey);
      expect(importedHash).toBe(original.publicKeyHash);
    });

    it('should export keypair to valid format', async () => {
      const keypair = await generateKeypair();
      const exported = await exportKeypair(keypair);

      expect(exported.publicKey).toMatch(/^[A-Za-z0-9+/=]+$/); // Base64
      expect(exported.privateKey).toMatch(/^[A-Za-z0-9+/=]+$/); // Base64
      expect(exported.publicKeyHash).toBe(keypair.publicKeyHash);
    });

    it('should maintain functionality after import', async () => {
      const keypair1 = await generateKeypair();
      const keypair2 = await generateKeypair();

      // Export and import keypair1
      const exported = await exportKeypair(keypair1);
      const imported = await importKeypair(exported);

      // Derive shared keys with both original and imported
      const shared1 = await deriveSharedKey(keypair1.privateKey, keypair2.publicKey);
      const shared2 = await deriveSharedKey(imported.privateKey, keypair2.publicKey);

      // Both should produce same encryption/decryption results
      const plaintext = new TextEncoder().encode('test message');
      const encrypted = await encrypt(plaintext, shared1);
      const decrypted = await decrypt(encrypted, shared2);

      expect(decrypted).toEqual(plaintext);
    });
  });

  describe('Public Key Export/Import', () => {
    it('should export and import public key only', async () => {
      const keypair = await generateKeypair();

      const exported = await exportPublicKey(keypair.publicKey);
      const imported = await importPublicKey(exported);

      // Should be able to derive same shared key with imported public key
      const hash1 = await hashPublicKey(keypair.publicKey);
      const hash2 = await hashPublicKey(imported);

      expect(hash1).toBe(hash2);
    });

    it('should match public key from full keypair export', async () => {
      const keypair = await generateKeypair();

      const publicKeyOnly = await exportPublicKey(keypair.publicKey);
      const fullExport = await exportKeypair(keypair);

      expect(publicKeyOnly).toBe(fullExport.publicKey);
    });
  });

  describe('Shared Key Derivation (ECDH)', () => {
    it('should derive same shared key from both sides', async () => {
      const alice = await generateKeypair();
      const bob = await generateKeypair();

      // Alice derives shared key with Bob's public key
      const aliceShared = await deriveSharedKey(alice.privateKey, bob.publicKey);

      // Bob derives shared key with Alice's public key
      const bobShared = await deriveSharedKey(bob.privateKey, alice.publicKey);

      // Both should be able to encrypt/decrypt with each other's keys
      const message = new TextEncoder().encode('secret message');
      const encrypted = await encrypt(message, aliceShared);
      const decrypted = await decrypt(encrypted, bobShared);

      expect(decrypted).toEqual(message);
    });

    it('should derive different keys for different pairs', async () => {
      const alice = await generateKeypair();
      const bob = await generateKeypair();
      const charlie = await generateKeypair();

      const aliceBob = await deriveSharedKey(alice.privateKey, bob.publicKey);
      const aliceCharlie = await deriveSharedKey(alice.privateKey, charlie.publicKey);

      // Different shared keys should not be able to decrypt each other's messages
      const message = new TextEncoder().encode('test');
      const encrypted = await encrypt(message, aliceBob);

      await expect(decrypt(encrypted, aliceCharlie)).rejects.toThrow();
    });

    it('should enable secure message exchange', async () => {
      const sender = await generateKeypair();
      const recipient = await generateKeypair();

      // Sender encrypts for recipient
      const sharedKey = await deriveSharedKey(sender.privateKey, recipient.publicKey);
      const message = new TextEncoder().encode('Private message from sender to recipient');
      const encrypted = await encrypt(message, sharedKey);

      // Recipient decrypts
      const recipientKey = await deriveSharedKey(recipient.privateKey, sender.publicKey);
      const decrypted = await decrypt(encrypted, recipientKey);

      expect(new TextDecoder().decode(decrypted)).toBe('Private message from sender to recipient');
    });
  });

  describe('Multi-Device Support', () => {
    it('should support exporting keypair for multi-device use', async () => {
      // Simulate device 1
      const device1Keypair = await generateKeypair();
      const exported = await exportKeypair(device1Keypair);

      // Simulate transferring to device 2
      const device2Keypair = await importKeypair(exported);

      // Both devices should have same identity
      expect(device2Keypair.publicKeyHash).toBe(device1Keypair.publicKeyHash);

      // Both should derive same shared keys
      const otherUser = await generateKeypair();
      const device1Shared = await deriveSharedKey(device1Keypair.privateKey, otherUser.publicKey);
      const device2Shared = await deriveSharedKey(device2Keypair.privateKey, otherUser.publicKey);

      const message = new TextEncoder().encode('test');
      const encrypted = await encrypt(message, device1Shared);
      const decrypted = await decrypt(encrypted, device2Shared);

      expect(decrypted).toEqual(message);
    });
  });

  describe('Security Properties', () => {
    it('should generate 64-character hex hash for public key', async () => {
      const keypair = await generateKeypair();

      expect(keypair.publicKeyHash).toMatch(/^[0-9a-f]{64}$/);
      expect(keypair.publicKeyHash.length).toBe(64);
    });

    it('should not allow deriving private key from public key', async () => {
      const keypair = await generateKeypair();
      const exported = await exportPublicKey(keypair.publicKey);
      const imported = await importPublicKey(exported);

      // Imported public key should not have private key capabilities
      expect(imported.type).toBe('public');

      // Should not be able to use it for key derivation (as private key)
      const otherKeypair = await generateKeypair();
      await expect(deriveSharedKey(imported as any, otherKeypair.publicKey)).rejects.toThrow();
    });
  });
});
