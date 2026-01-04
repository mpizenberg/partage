/**
 * Member data types
 */

export type MemberStatus = 'active' | 'departed';

export interface Member {
  id: string; // Public key hash
  name: string;
  publicKey: string; // Serialized public key (Base64)
  joinedAt: number; // Unix timestamp
  leftAt?: number; // Unix timestamp
  status: MemberStatus;
}
