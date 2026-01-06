/**
 * Tests for key exchange protocol
 */

import { describe, it, expect } from 'vitest';
import { generateKeypair, exportPublicKey } from '../../src/core/crypto/keypair';
import { generateSigningKeypair } from '../../src/core/crypto/signatures';
import {
  encryptGroupKeysForRecipient,
  decryptGroupKeysFromSender,
  signKeyPackage,
  verifyKeyPackage,
  createKeyPackage,
  verifyAndDecryptKeyPackage,
} from '../../src/core/crypto/key-exchange';
import type { GroupKeysPayload } from '@partage/shared';

describe('Key Exchange', () => {
  describe('encryptGroupKeysForRecipient / decryptGroupKeysFromSender', () => {
    it('should encrypt and decrypt group keys between two users', async () => {
      // Setup: Two users with keypairs
      const alice = await generateKeypair();
      const bob = await generateKeypair();

      // Alice's group keys to share
      const payload: GroupKeysPayload = {
        groupId: 'test-group',
        keys: [
          {
            version: 1,
            key: 'base64-encoded-key-v1',
            rotatedAt: Date.now(),
            rotatedBy: alice.publicKeyHash,
          },
        ],
        currentKeyVersion: 1,
      };

      // Alice encrypts keys for Bob
      const bobPublicKeyBase64 = await exportPublicKey(bob.publicKey);
      const encryptedKeys = await encryptGroupKeysForRecipient(
        payload,
        bobPublicKeyBase64,
        alice.privateKey
      );

      // Verify encrypted format
      expect(encryptedKeys.iv).toBeTruthy();
      expect(encryptedKeys.ciphertext).toBeTruthy();

      // Bob decrypts keys from Alice
      const alicePublicKeyBase64 = await exportPublicKey(alice.publicKey);
      const decrypted = await decryptGroupKeysFromSender(
        encryptedKeys,
        alicePublicKeyBase64,
        bob.privateKey
      );

      // Verify decrypted payload matches original
      expect(decrypted).toEqual(payload);
    });

    it('should fail to decrypt with wrong private key', async () => {
      const alice = await generateKeypair();
      const bob = await generateKeypair();
      const eve = await generateKeypair(); // Attacker

      const payload: GroupKeysPayload = {
        groupId: 'test-group',
        keys: [{ version: 1, key: 'key-v1', rotatedAt: Date.now(), rotatedBy: 'alice' }],
        currentKeyVersion: 1,
      };

      // Alice encrypts keys for Bob
      const bobPublicKeyBase64 = await exportPublicKey(bob.publicKey);
      const encryptedKeys = await encryptGroupKeysForRecipient(
        payload,
        bobPublicKeyBase64,
        alice.privateKey
      );

      // Eve tries to decrypt (should fail)
      const alicePublicKeyBase64 = await exportPublicKey(alice.publicKey);
      await expect(
        decryptGroupKeysFromSender(encryptedKeys, alicePublicKeyBase64, eve.privateKey)
      ).rejects.toThrow();
    });

    it('should fail to decrypt tampered ciphertext', async () => {
      const alice = await generateKeypair();
      const bob = await generateKeypair();

      const payload: GroupKeysPayload = {
        groupId: 'test-group',
        keys: [{ version: 1, key: 'key-v1', rotatedAt: Date.now(), rotatedBy: 'alice' }],
        currentKeyVersion: 1,
      };

      const bobPublicKeyBase64 = await exportPublicKey(bob.publicKey);
      const encryptedKeys = await encryptGroupKeysForRecipient(
        payload,
        bobPublicKeyBase64,
        alice.privateKey
      );

      // Tamper with ciphertext
      const tampered = {
        ...encryptedKeys,
        ciphertext: encryptedKeys.ciphertext.slice(0, -1) + 'X',
      };

      // Decryption should fail due to auth tag mismatch
      const alicePublicKeyBase64 = await exportPublicKey(alice.publicKey);
      await expect(
        decryptGroupKeysFromSender(tampered, alicePublicKeyBase64, bob.privateKey)
      ).rejects.toThrow();
    });
  });

  describe('signKeyPackage / verifyKeyPackage', () => {
    it('should sign and verify key package', async () => {
      const signingKeypair = await generateSigningKeypair();

      const encryptedKeys = {
        iv: 'test-iv',
        ciphertext: 'test-ciphertext',
      };

      // Sign the package
      const signature = await signKeyPackage(encryptedKeys, signingKeypair.privateKey);
      expect(signature).toBeTruthy();

      // Export public key for verification
      const publicKeyBuffer = await crypto.subtle.exportKey('raw', signingKeypair.publicKey);
      const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)));

      // Verify the signature
      const isValid = await verifyKeyPackage(encryptedKeys, signature, publicKeyBase64);
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const signingKeypair = await generateSigningKeypair();
      const otherKeypair = await generateSigningKeypair();

      const encryptedKeys = {
        iv: 'test-iv',
        ciphertext: 'test-ciphertext',
      };

      // Sign with one key
      const signature = await signKeyPackage(encryptedKeys, signingKeypair.privateKey);

      // Try to verify with different key (should fail)
      const wrongPublicKeyBuffer = await crypto.subtle.exportKey('raw', otherKeypair.publicKey);
      const wrongPublicKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(wrongPublicKeyBuffer))
      );

      const isValid = await verifyKeyPackage(encryptedKeys, signature, wrongPublicKeyBase64);
      expect(isValid).toBe(false);
    });

    it('should reject tampered encrypted data', async () => {
      const signingKeypair = await generateSigningKeypair();

      const encryptedKeys = {
        iv: 'test-iv',
        ciphertext: 'test-ciphertext',
      };

      const signature = await signKeyPackage(encryptedKeys, signingKeypair.privateKey);

      // Tamper with encrypted data
      const tampered = {
        ...encryptedKeys,
        ciphertext: 'tampered-ciphertext',
      };

      const publicKeyBuffer = await crypto.subtle.exportKey('raw', signingKeypair.publicKey);
      const publicKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(publicKeyBuffer)));

      const isValid = await verifyKeyPackage(tampered, signature, publicKeyBase64);
      expect(isValid).toBe(false);
    });
  });

  describe('createKeyPackage / verifyAndDecryptKeyPackage', () => {
    it('should create and verify+decrypt complete key package', async () => {
      // Setup: Alice (sender) and Bob (recipient)
      const alice = await generateKeypair();
      const aliceSigningKeypair = await generateSigningKeypair();
      const bob = await generateKeypair();

      const payload: GroupKeysPayload = {
        groupId: 'test-group',
        keys: [
          {
            version: 1,
            key: 'key-v1',
            rotatedAt: Date.now() - 1000,
            rotatedBy: alice.publicKeyHash,
          },
          {
            version: 2,
            key: 'key-v2',
            rotatedAt: Date.now(),
            rotatedBy: alice.publicKeyHash,
          },
        ],
        currentKeyVersion: 2,
      };

      // Alice creates key package for Bob
      const bobPublicKeyBase64 = await exportPublicKey(bob.publicKey);
      const { encryptedKeys, signature } = await createKeyPackage(
        payload,
        bobPublicKeyBase64,
        alice.privateKey,
        aliceSigningKeypair.privateKey
      );

      // Bob verifies and decrypts
      const alicePublicKeyBase64 = await exportPublicKey(alice.publicKey);
      const aliceVerificationKeyBuffer = await crypto.subtle.exportKey(
        'raw',
        aliceSigningKeypair.publicKey
      );
      const aliceVerificationKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(aliceVerificationKeyBuffer))
      );

      const decrypted = await verifyAndDecryptKeyPackage(
        encryptedKeys,
        signature,
        alicePublicKeyBase64,
        aliceVerificationKeyBase64,
        bob.privateKey
      );

      expect(decrypted).toEqual(payload);
    });

    it('should reject key package with invalid signature', async () => {
      const alice = await generateKeypair();
      const aliceSigningKeypair = await generateSigningKeypair();
      const bob = await generateKeypair();
      const eveSigningKeypair = await generateSigningKeypair(); // Attacker

      const payload: GroupKeysPayload = {
        groupId: 'test-group',
        keys: [{ version: 1, key: 'key-v1', rotatedAt: Date.now(), rotatedBy: 'alice' }],
        currentKeyVersion: 1,
      };

      // Alice creates key package
      const bobPublicKeyBase64 = await exportPublicKey(bob.publicKey);
      const { encryptedKeys } = await createKeyPackage(
        payload,
        bobPublicKeyBase64,
        alice.privateKey,
        aliceSigningKeypair.privateKey
      );

      // Eve creates a fake signature
      const fakeSignature = await signKeyPackage(encryptedKeys, eveSigningKeypair.privateKey);

      // Bob tries to verify with Alice's key (should fail)
      const alicePublicKeyBase64 = await exportPublicKey(alice.publicKey);
      const aliceVerificationKeyBuffer = await crypto.subtle.exportKey(
        'raw',
        aliceSigningKeypair.publicKey
      );
      const aliceVerificationKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(aliceVerificationKeyBuffer))
      );

      await expect(
        verifyAndDecryptKeyPackage(
          encryptedKeys,
          fakeSignature,
          alicePublicKeyBase64,
          aliceVerificationKeyBase64,
          bob.privateKey
        )
      ).rejects.toThrow('Invalid key package signature');
    });

    it('should handle multiple historical keys', async () => {
      const alice = await generateKeypair();
      const aliceSigningKeypair = await generateSigningKeypair();
      const bob = await generateKeypair();

      // Multiple key versions (simulating key rotation history)
      const payload: GroupKeysPayload = {
        groupId: 'test-group',
        keys: [
          { version: 1, key: 'key-v1', rotatedAt: Date.now() - 3000, rotatedBy: 'alice' },
          { version: 2, key: 'key-v2', rotatedAt: Date.now() - 2000, rotatedBy: 'alice' },
          { version: 3, key: 'key-v3', rotatedAt: Date.now() - 1000, rotatedBy: 'bob' },
          { version: 4, key: 'key-v4', rotatedAt: Date.now(), rotatedBy: 'charlie' },
        ],
        currentKeyVersion: 4,
      };

      const bobPublicKeyBase64 = await exportPublicKey(bob.publicKey);
      const { encryptedKeys, signature } = await createKeyPackage(
        payload,
        bobPublicKeyBase64,
        alice.privateKey,
        aliceSigningKeypair.privateKey
      );

      const alicePublicKeyBase64 = await exportPublicKey(alice.publicKey);
      const aliceVerificationKeyBuffer = await crypto.subtle.exportKey(
        'raw',
        aliceSigningKeypair.publicKey
      );
      const aliceVerificationKeyBase64 = btoa(
        String.fromCharCode(...new Uint8Array(aliceVerificationKeyBuffer))
      );

      const decrypted = await verifyAndDecryptKeyPackage(
        encryptedKeys,
        signature,
        alicePublicKeyBase64,
        aliceVerificationKeyBase64,
        bob.privateKey
      );

      expect(decrypted.keys).toHaveLength(4);
      expect(decrypted.currentKeyVersion).toBe(4);
      expect(decrypted.keys.map((k) => k.version)).toEqual([1, 2, 3, 4]);
    });
  });
});
