/**
 * Group data types
 */

import type { Member } from './member';

/**
 * Settlement preferences for a user
 * Lists members this user prefers to send money to (in priority order)
 */
export interface SettlementPreference {
  userId: string; // The user who has this preference
  preferredRecipients: string[]; // Member IDs in order of preference
}

export interface Group {
  id: string;
  // name removed - now stored in encrypted GroupMetadataState
  defaultCurrency: string; // ISO 4217 code (e.g., 'USD', 'EUR')
  createdAt: number; // Unix timestamp
  createdBy: string; // Public key hash
  currentKeyVersion: number;
  settings: GroupSettings;
  activeMembers?: Member[];
}

export interface GroupSettings {
  anyoneCanAddEntries: boolean;
  anyoneCanModifyEntries: boolean;
  anyoneCanDeleteEntries: boolean;
  anyoneCanInvite: boolean;
  anyoneCanShareKeys: boolean;
}

export const DEFAULT_GROUP_SETTINGS: GroupSettings = {
  anyoneCanAddEntries: true,
  anyoneCanModifyEntries: true,
  anyoneCanDeleteEntries: true,
  anyoneCanInvite: true,
  anyoneCanShareKeys: true,
};
