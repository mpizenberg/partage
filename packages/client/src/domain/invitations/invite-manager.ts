/**
 * Invite Manager - Orchestrates the invitation and joining workflow
 *
 * Flow:
 * 1. Member creates invitation -> generates invite link
 * 2. New user clicks invite link -> sees group info
 * 3. New user submits join request (with their public key)
 * 4. Existing member(s) approve and send encrypted keys
 * 5. New user receives keys and joins group
 */

import type {
  Invitation,
  JoinRequest,
  EncryptedKeyPackage,
  GroupKeysPayload,
  InviteLinkData,
} from '@partage/shared';
import type { UserKeypair } from '@partage/shared';
import { exportPublicKey, hashPublicKey } from '../../core/crypto/keypair.js';
import { createKeyPackage } from '../../core/crypto/key-exchange.js';

/**
 * Create an invitation for a group
 *
 * @param groupId - ID of the group to invite to
 * @param groupName - Name of the group (for display in invite link)
 * @param inviterKeypair - Inviter's keypair (for identification)
 * @param options - Optional invite settings
 * @returns Invitation record and shareable invite link
 */
export async function createInvitation(
  groupId: string,
  groupName: string,
  inviterKeypair: UserKeypair,
  options?: {
    expiresAt?: number;
    maxUses?: number;
  }
): Promise<{ invitation: Invitation; inviteLink: string }> {
  const invitation: Invitation = {
    id: crypto.randomUUID(), // Client-generated ID
    groupId,
    inviterPublicKeyHash: inviterKeypair.publicKeyHash,
    createdAt: Date.now(),
    expiresAt: options?.expiresAt,
    maxUses: options?.maxUses,
    usedCount: 0,
    status: 'active',
  };

  // Create invite link data
  const linkData: InviteLinkData = {
    invitationId: invitation.id,
    groupId,
    groupName,
  };

  // Encode link data as Base64 for URL
  const linkDataJSON = JSON.stringify(linkData);
  const linkDataBase64 = btoa(linkDataJSON);
  const inviteLink = `${window.location.origin}/join/${linkDataBase64}`;

  return { invitation, inviteLink };
}

/**
 * Parse an invite link to extract invitation data
 *
 * @param inviteLink - Full invite URL
 * @returns Parsed invitation link data
 */
export function parseInviteLink(inviteLink: string): InviteLinkData {
  // Extract Base64 portion from URL (last segment after /join/)
  const linkDataBase64 = inviteLink.split('/join/')[1];
  if (!linkDataBase64) {
    throw new Error('Invalid invite link format');
  }

  const linkDataJSON = atob(linkDataBase64);
  return JSON.parse(linkDataJSON) as InviteLinkData;
}

/**
 * Create a join request when user clicks invite link
 *
 * @param invitationId - ID of the invitation being used
 * @param groupId - ID of the group to join
 * @param requesterKeypair - New user's keypair
 * @param requesterName - Display name chosen by user
 * @returns Join request record
 */
export async function createJoinRequest(
  invitationId: string,
  groupId: string,
  requesterKeypair: UserKeypair,
  requesterName: string
): Promise<JoinRequest> {
  const requesterPublicKey = await exportPublicKey(requesterKeypair.publicKey);

  const joinRequest: JoinRequest = {
    id: crypto.randomUUID(),
    invitationId,
    groupId,
    requesterPublicKey,
    requesterPublicKeyHash: requesterKeypair.publicKeyHash,
    requesterName,
    requestedAt: Date.now(),
    status: 'pending',
  };

  return joinRequest;
}

/**
 * Process a join request by sending encrypted keys to the new member
 * This is called by existing group members
 *
 * @param joinRequest - The join request to approve
 * @param groupKeys - All historical group keys to share
 * @param senderKeypair - Sender's keypair (for ECDH)
 * @param senderSigningKeypair - Sender's signing keypair (for signatures)
 * @returns Encrypted key package to send to new member
 */
export async function processJoinRequest(
  joinRequest: JoinRequest,
  groupKeys: GroupKeysPayload,
  senderKeypair: UserKeypair,
  senderSigningKeypair: CryptoKeyPair
): Promise<EncryptedKeyPackage> {
  // Create encrypted key package for the requester
  const { encryptedKeys, signature } = await createKeyPackage(
    groupKeys,
    joinRequest.requesterPublicKey,
    senderKeypair.privateKey,
    senderSigningKeypair.privateKey
  );

  // Export sender's verification key
  const senderVerificationKeyBuffer = await crypto.subtle.exportKey(
    'raw',
    senderSigningKeypair.publicKey
  );
  const senderVerificationKey = btoa(
    String.fromCharCode(...new Uint8Array(senderVerificationKeyBuffer))
  );

  const keyPackage: EncryptedKeyPackage = {
    id: crypto.randomUUID(),
    joinRequestId: joinRequest.id,
    groupId: joinRequest.groupId,
    recipientPublicKeyHash: joinRequest.requesterPublicKeyHash,
    senderPublicKeyHash: senderKeypair.publicKeyHash,
    encryptedKeys,
    createdAt: Date.now(),
    signature,
  };

  return keyPackage;
}

/**
 * Check if an invitation is still valid
 *
 * @param invitation - Invitation to validate
 * @returns true if invitation can still be used
 */
export function isInvitationValid(invitation: Invitation): boolean {
  // Check status
  if (invitation.status !== 'active') {
    return false;
  }

  // Check expiration
  if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
    return false;
  }

  // Check usage limit
  if (invitation.maxUses && invitation.usedCount >= invitation.maxUses) {
    return false;
  }

  return true;
}

/**
 * Mark an invitation as used (increment usedCount)
 *
 * @param invitation - Invitation to update
 * @returns Updated invitation
 */
export function markInvitationUsed(invitation: Invitation): Invitation {
  return {
    ...invitation,
    usedCount: invitation.usedCount + 1,
  };
}

/**
 * Revoke an invitation
 *
 * @param invitation - Invitation to revoke
 * @returns Updated invitation
 */
export function revokeInvitation(invitation: Invitation): Invitation {
  return {
    ...invitation,
    status: 'revoked',
  };
}
