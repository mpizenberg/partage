/**
 * Invitation and group joining types for Phase 5
 */

export type InvitationStatus = 'active' | 'expired' | 'revoked';
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';

/**
 * Invitation record stored on server
 * Used to generate shareable invite links for joining groups
 */
export interface Invitation {
  id: string; // Unique invitation ID
  groupId: string; // Which group this invitation is for
  inviterPublicKeyHash: string; // Who created this invitation
  createdAt: number; // Unix timestamp
  expiresAt?: number; // Optional expiration timestamp
  maxUses?: number; // Maximum number of times this can be used (optional)
  usedCount: number; // How many times this has been used
  status: InvitationStatus;
}

/**
 * Join request created when a user clicks an invite link
 * Represents a pending request to join a group
 */
export interface JoinRequest {
  id: string; // Unique join request ID
  invitationId: string; // Which invitation was used
  groupId: string; // Which group they want to join
  requesterPublicKey: string; // Base64 serialized public key of requester
  requesterPublicKeyHash: string; // SHA-256 hash of public key (becomes member ID)
  requesterName: string; // Display name chosen by requester
  requestedAt: number; // Unix timestamp
  status: JoinRequestStatus;
  approvedBy?: string; // Public key hash of approver (if approved)
  approvedAt?: number; // Unix timestamp (if approved)
  rejectedBy?: string; // Public key hash of rejecter (if rejected)
  rejectedAt?: number; // Unix timestamp (if rejected)
  rejectionReason?: string; // Optional reason for rejection
}

/**
 * Encrypted group key package sent to new member
 * Contains all historical keys so new member can decrypt old entries
 */
export interface EncryptedKeyPackage {
  id: string; // Unique package ID
  joinRequestId: string; // Which join request this is for
  groupId: string; // Which group these keys are for
  recipientPublicKeyHash: string; // Who this package is for
  senderPublicKeyHash: string; // Who encrypted and sent this package
  senderPublicKey: string; // Sender's ECDH public key (Base64) for decryption
  senderSigningPublicKey: string; // Sender's signing public key (Base64) for verification
  encryptedKeys: EncryptedGroupKeys; // The actual encrypted keys
  createdAt: number; // Unix timestamp
  signature: string; // Base64 ECDSA signature for verification
}

/**
 * Encrypted group keys (encrypted with recipient's public key)
 * This is the payload inside EncryptedKeyPackage.encryptedKeys
 * Note: In AES-GCM, the authentication tag is included in the ciphertext
 */
export interface EncryptedGroupKeys {
  iv: string; // Base64 initialization vector for AES-GCM
  ciphertext: string; // Base64 encrypted data (includes auth tag)
}

/**
 * Decrypted group keys payload (what's inside the encrypted package)
 * Contains all historical keys for the group
 */
export interface GroupKeysPayload {
  groupId: string;
  keys: Array<{
    version: number;
    key: string; // Base64 serialized AES key
    rotatedAt: number; // Unix timestamp
    rotatedBy: string; // Public key hash of who rotated
  }>;
  currentKeyVersion: number;
}

/**
 * Invite link data structure
 * This is what gets encoded in the shareable URL
 */
export interface InviteLinkData {
  invitationId: string;
  groupId: string;
  groupName: string; // For display purposes
}
