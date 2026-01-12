/**
 * Member data types
 */

export type MemberStatus = 'active' | 'departed';

export interface Member {
  id: string; // Public key hash for real members, UUID for virtual members
  name: string;
  publicKey?: string; // Serialized public key (Base64) - optional for virtual members
  joinedAt: number; // Unix timestamp
  leftAt?: number; // Unix timestamp
  status: MemberStatus;
  isVirtual?: boolean; // True for virtual (name-only) members in Phase 3
  addedBy?: string; // Public key hash of user who added virtual member
}

/**
 * Links a new member ID to an existing virtual member ID
 * Used when someone joins and claims an existing identity
 */
export interface MemberAlias {
  newMemberId: string; // The joining member's ID
  existingMemberId: string; // The virtual member being claimed
  linkedAt: number; // Unix timestamp
  linkedBy: string; // Who created the link (same as newMemberId)
}
