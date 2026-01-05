/**
 * Group data types
 */

import type { Member } from './member';

export interface Group {
  id: string;
  name: string;
  defaultCurrency: string; // ISO 4217 code (e.g., 'USD', 'EUR')
  createdAt: number; // Unix timestamp
  createdBy: string; // Public key hash
  currentKeyVersion: number;
  settings: GroupSettings;
  members?: Member[]; // Optional for Phase 3 local-only support
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
