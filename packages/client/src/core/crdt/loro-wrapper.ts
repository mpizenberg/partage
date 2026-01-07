/**
 * Loro CRDT wrapper with two-layer encryption
 *
 * Architecture:
 * - Layer 1 (Loro/Unencrypted): Metadata (id, timestamp, actor, version)
 * - Layer 2 (Encrypted): Sensitive entry data (description, amounts, members)
 *
 * This allows:
 * - Server to relay CRDT operations without seeing sensitive content
 * - Efficient CRDT conflict resolution on metadata
 * - End-to-end encryption of actual entry details
 */

import { Loro, LoroMap } from 'loro-crdt';
import { encryptJSON, decryptJSON } from '../crypto/symmetric.js';
import type { Entry, ExpenseEntry, TransferEntry, Member } from '@partage/shared';

/**
 * Metadata stored in Loro (unencrypted)
 */
interface EntryMetadata {
  id: string;
  groupId: string;
  type: 'expense' | 'transfer';
  version: number;
  previousVersionId?: string;
  createdAt: number;
  createdBy: string;
  modifiedAt?: number;
  modifiedBy?: string;
  deletedAt?: number;
  deletedBy?: string;
  status: 'active' | 'deleted';
  encryptedPayload: string; // Base64-encoded encrypted data
}

/**
 * Sensitive data that gets encrypted (expense-specific)
 */
interface ExpensePayload {
  description: string;
  category?: string;
  location?: string;
  amount: number;
  currency: string;
  defaultCurrencyAmount?: number;
  exchangeRate?: number;
  date: number;
  notes?: string;
  payers: Array<{ memberId: string; amount: number }>;
  beneficiaries: Array<{
    memberId: string;
    splitType: 'shares' | 'exact';
    shares?: number;
    amount?: number;
  }>;
  deletionReason?: string;
}

/**
 * Sensitive data that gets encrypted (transfer-specific)
 */
interface TransferPayload {
  from: string;
  to: string;
  amount: number;
  currency: string;
  defaultCurrencyAmount?: number;
  exchangeRate?: number;
  date: number;
  notes?: string;
  deletionReason?: string;
}

type EntryPayload = ExpensePayload | TransferPayload;

/**
 * Loro CRDT wrapper for encrypted entry management and member synchronization
 */
export class LoroEntryStore {
  private loro: Loro;
  private entries: LoroMap;
  private members: LoroMap;

  constructor(peerId?: string) {
    // Create Loro with a peer ID if provided (important for multi-device sync)
    this.loro = new Loro();
    if (peerId) {
      // Convert string peer ID to a stable numeric value
      // Use a simple hash function to convert the string to a BigInt
      const numericPeerId = this.stringToPeerId(peerId);
      this.loro.setPeerId(numericPeerId);
    }
    this.entries = this.loro.getMap('entries');
    this.members = this.loro.getMap('members');
  }

  /**
   * Create a new entry (expense or transfer)
   */
  async createEntry(entry: Entry, groupKey: CryptoKey, _actorId: string): Promise<void> {
    // Separate metadata from payload
    const { metadata, payload } = this.splitEntry(entry);

    // Encrypt the sensitive payload
    const encrypted = await encryptJSON(payload, groupKey);
    const encryptedPayload = this.serializeEncryptedData(encrypted);

    // Store metadata + encrypted payload in Loro
    const entryMetadata: EntryMetadata = {
      ...metadata,
      encryptedPayload,
    };

    // Use Loro map to store the entry
    const entryMap = this.entries.setContainer(entry.id, new LoroMap()) as LoroMap;
    this.setMetadataInMap(entryMap, entryMetadata);
  }

  /**
   * Modify an existing entry (creates new version)
   */
  async modifyEntry(
    originalId: string,
    updatedEntry: Entry,
    groupKey: CryptoKey,
    actorId: string
  ): Promise<void> {
    // Create a new entry with version incremented
    const newEntry: Entry = {
      ...updatedEntry,
      previousVersionId: originalId,
      modifiedAt: Date.now(),
      modifiedBy: actorId,
    };

    await this.createEntry(newEntry, groupKey, actorId);
  }

  /**
   * Soft delete an entry
   */
  async deleteEntry(
    entryId: string,
    actorId: string,
    groupKey: CryptoKey,
    reason?: string
  ): Promise<void> {
    const entry = await this.getEntry(entryId, groupKey);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found`);
    }

    // Mark as deleted in metadata
    const entryMap = this.entries.get(entryId);
    if (entryMap && entryMap instanceof LoroMap) {
      entryMap.set('status', 'deleted');
      entryMap.set('deletedAt', Date.now());
      entryMap.set('deletedBy', actorId);

      // If there's a deletion reason, we need to re-encrypt the payload with it
      if (reason) {
        const { payload } = this.splitEntry(entry);
        const updatedPayload = { ...payload, deletionReason: reason };
        const encrypted = await encryptJSON(updatedPayload, groupKey);
        const encryptedPayload = this.serializeEncryptedData(encrypted);
        entryMap.set('encryptedPayload', encryptedPayload);
      }
    }
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(entryId: string, groupKey: CryptoKey): Promise<Entry | null> {
    const entryMap = this.entries.get(entryId);
    if (!entryMap || !(entryMap instanceof LoroMap)) {
      return null;
    }

    const metadata = this.getMetadataFromMap(entryMap);
    const payload = await this.decryptPayload(metadata.encryptedPayload, groupKey);

    return this.mergeEntry(metadata, payload);
  }

  /**
   * Get all active entries for a group
   */
  async getAllEntries(groupId: string, groupKey: CryptoKey): Promise<Entry[]> {
    const allEntries: Entry[] = [];
    const entriesObj = this.entries.toJSON();

    for (const [entryId, _] of Object.entries(entriesObj)) {
      const entry = await this.getEntry(entryId, groupKey);
      if (entry && entry.groupId === groupId) {
        allEntries.push(entry);
      }
    }

    return allEntries;
  }

  /**
   * Get all active (non-deleted) entries
   */
  async getActiveEntries(groupId: string, groupKey: CryptoKey): Promise<Entry[]> {
    const allEntries = await this.getAllEntries(groupId, groupKey);
    return allEntries.filter((entry) => entry.status === 'active');
  }

  // ==================== Member Management ====================

  /**
   * Add a new member to the group
   */
  addMember(member: Member): void {
    const memberMap = this.members.setContainer(member.id, new LoroMap()) as LoroMap;
    memberMap.set('id', member.id);
    memberMap.set('name', member.name);
    if (member.publicKey) memberMap.set('publicKey', member.publicKey);
    memberMap.set('joinedAt', member.joinedAt);
    if (member.leftAt) memberMap.set('leftAt', member.leftAt);
    memberMap.set('status', member.status);
    if (member.isVirtual) memberMap.set('isVirtual', member.isVirtual);
    if (member.addedBy) memberMap.set('addedBy', member.addedBy);
  }

  /**
   * Get all members from the CRDT
   */
  getMembers(): Member[] {
    const members: Member[] = [];
    const memberIds = this.members.keys();

    for (const id of memberIds) {
      const memberMap = this.members.get(id);
      if (!memberMap || !(memberMap instanceof LoroMap)) continue;

      members.push({
        id: memberMap.get('id') as string,
        name: memberMap.get('name') as string,
        publicKey: memberMap.get('publicKey') as string | undefined,
        joinedAt: memberMap.get('joinedAt') as number,
        leftAt: memberMap.get('leftAt') as number | undefined,
        status: (memberMap.get('status') as 'active' | 'departed') || 'active',
        isVirtual: memberMap.get('isVirtual') as boolean | undefined,
        addedBy: memberMap.get('addedBy') as string | undefined,
      });
    }

    return members;
  }

  /**
   * Update an existing member (e.g., status change, virtual member replacement)
   */
  updateMember(memberId: string, updates: Partial<Member>): void {
    const memberMap = this.members.get(memberId);
    if (!memberMap || !(memberMap instanceof LoroMap)) return;

    if (updates.name !== undefined) memberMap.set('name', updates.name);
    if (updates.publicKey !== undefined) memberMap.set('publicKey', updates.publicKey);
    if (updates.leftAt !== undefined) memberMap.set('leftAt', updates.leftAt);
    if (updates.status !== undefined) memberMap.set('status', updates.status);
    if (updates.isVirtual !== undefined) memberMap.set('isVirtual', updates.isVirtual);
    if (updates.addedBy !== undefined) memberMap.set('addedBy', updates.addedBy);
  }

  /**
   * Export Loro snapshot as bytes (for storage/sync)
   */
  exportSnapshot(): Uint8Array {
    return this.loro.export({ mode: 'snapshot' });
  }

  /**
   * Import Loro snapshot from bytes
   */
  importSnapshot(snapshot: Uint8Array): void {
    this.loro.import(snapshot);
    this.entries = this.loro.getMap('entries');
    this.members = this.loro.getMap('members');
  }

  /**
   * Get the current Loro version (for sync)
   */
  getVersion(): any {
    return this.loro.oplogVersion();
  }

  /**
   * Apply updates from another Loro instance
   */
  applyUpdate(update: Uint8Array): void {
    this.loro.import(update);
  }

  /**
   * Export updates since a given version (for incremental sync)
   */
  exportFrom(version: any): Uint8Array {
    return this.loro.export({ mode: 'update', from: version });
  }

  // ==================== Private Helper Methods ====================

  /**
   * Split an entry into metadata and encrypted payload
   */
  private splitEntry(entry: Entry): { metadata: Omit<EntryMetadata, 'encryptedPayload'>; payload: EntryPayload } {
    const metadata = {
      id: entry.id,
      groupId: entry.groupId,
      type: entry.type,
      version: entry.version,
      previousVersionId: entry.previousVersionId,
      createdAt: entry.createdAt,
      createdBy: entry.createdBy,
      modifiedAt: entry.modifiedAt,
      modifiedBy: entry.modifiedBy,
      deletedAt: entry.deletedAt,
      deletedBy: entry.deletedBy,
      status: entry.status,
    };

    let payload: EntryPayload;

    if (entry.type === 'expense') {
      const expenseEntry = entry as ExpenseEntry;
      payload = {
        description: expenseEntry.description,
        category: expenseEntry.category,
        location: expenseEntry.location,
        amount: expenseEntry.amount,
        currency: expenseEntry.currency,
        defaultCurrencyAmount: expenseEntry.defaultCurrencyAmount,
        exchangeRate: expenseEntry.exchangeRate,
        date: expenseEntry.date,
        notes: expenseEntry.notes,
        payers: expenseEntry.payers,
        beneficiaries: expenseEntry.beneficiaries,
        deletionReason: expenseEntry.deletionReason,
      };
    } else {
      const transferEntry = entry as TransferEntry;
      payload = {
        from: transferEntry.from,
        to: transferEntry.to,
        amount: transferEntry.amount,
        currency: transferEntry.currency,
        defaultCurrencyAmount: transferEntry.defaultCurrencyAmount,
        exchangeRate: transferEntry.exchangeRate,
        date: transferEntry.date,
        notes: transferEntry.notes,
        deletionReason: transferEntry.deletionReason,
      };
    }

    return { metadata, payload };
  }

  /**
   * Merge metadata and decrypted payload back into Entry
   */
  private mergeEntry(metadata: EntryMetadata, payload: EntryPayload): Entry {
    const base = {
      id: metadata.id,
      groupId: metadata.groupId,
      version: metadata.version,
      previousVersionId: metadata.previousVersionId,
      createdAt: metadata.createdAt,
      createdBy: metadata.createdBy,
      modifiedAt: metadata.modifiedAt,
      modifiedBy: metadata.modifiedBy,
      deletedAt: metadata.deletedAt,
      deletedBy: metadata.deletedBy,
      status: metadata.status,
      amount: payload.amount,
      currency: payload.currency,
      defaultCurrencyAmount: payload.defaultCurrencyAmount,
      exchangeRate: payload.exchangeRate,
      date: payload.date,
      notes: payload.notes,
      deletionReason: payload.deletionReason,
    };

    if (metadata.type === 'expense') {
      const expensePayload = payload as ExpensePayload;
      return {
        ...base,
        type: 'expense',
        description: expensePayload.description,
        category: expensePayload.category as any,
        location: expensePayload.location,
        payers: expensePayload.payers,
        beneficiaries: expensePayload.beneficiaries,
      } as ExpenseEntry;
    } else {
      const transferPayload = payload as TransferPayload;
      return {
        ...base,
        type: 'transfer',
        from: transferPayload.from,
        to: transferPayload.to,
      } as TransferEntry;
    }
  }

  /**
   * Serialize encrypted data to Base64 string
   */
  private serializeEncryptedData(encrypted: { ciphertext: Uint8Array; iv: Uint8Array }): string {
    const combined = {
      ciphertext: Array.from(encrypted.ciphertext),
      iv: Array.from(encrypted.iv),
    };
    return btoa(JSON.stringify(combined));
  }

  /**
   * Deserialize encrypted data from Base64 string
   */
  private deserializeEncryptedData(serialized: string): { ciphertext: Uint8Array; iv: Uint8Array } {
    const parsed = JSON.parse(atob(serialized));
    return {
      ciphertext: new Uint8Array(parsed.ciphertext),
      iv: new Uint8Array(parsed.iv),
    };
  }

  /**
   * Decrypt an encrypted payload
   */
  private async decryptPayload(encryptedPayload: string, groupKey: CryptoKey): Promise<EntryPayload> {
    const encrypted = this.deserializeEncryptedData(encryptedPayload);
    return await decryptJSON<EntryPayload>(encrypted, groupKey);
  }

  /**
   * Set metadata in a Loro map
   */
  private setMetadataInMap(map: LoroMap, metadata: EntryMetadata): void {
    map.set('id', metadata.id);
    map.set('groupId', metadata.groupId);
    map.set('type', metadata.type);
    map.set('version', metadata.version);
    if (metadata.previousVersionId) map.set('previousVersionId', metadata.previousVersionId);
    map.set('createdAt', metadata.createdAt);
    map.set('createdBy', metadata.createdBy);
    if (metadata.modifiedAt) map.set('modifiedAt', metadata.modifiedAt);
    if (metadata.modifiedBy) map.set('modifiedBy', metadata.modifiedBy);
    if (metadata.deletedAt) map.set('deletedAt', metadata.deletedAt);
    if (metadata.deletedBy) map.set('deletedBy', metadata.deletedBy);
    map.set('status', metadata.status);
    map.set('encryptedPayload', metadata.encryptedPayload);
  }

  /**
   * Get metadata from a Loro map
   */
  private getMetadataFromMap(map: LoroMap): EntryMetadata {
    const obj = map.toJSON();
    return {
      id: obj.id as string,
      groupId: obj.groupId as string,
      type: obj.type as 'expense' | 'transfer',
      version: obj.version as number,
      previousVersionId: obj.previousVersionId as string | undefined,
      createdAt: obj.createdAt as number,
      createdBy: obj.createdBy as string,
      modifiedAt: obj.modifiedAt as number | undefined,
      modifiedBy: obj.modifiedBy as string | undefined,
      deletedAt: obj.deletedAt as number | undefined,
      deletedBy: obj.deletedBy as string | undefined,
      status: obj.status as 'active' | 'deleted',
      encryptedPayload: obj.encryptedPayload as string,
    };
  }

  /**
   * Convert a string peer ID to a stable numeric value for Loro
   * Uses a simple hash function to generate a consistent BigInt from the string
   */
  private stringToPeerId(peerId: string): bigint {
    let hash = 0n;
    for (let i = 0; i < peerId.length; i++) {
      const char = BigInt(peerId.charCodeAt(i));
      hash = ((hash << 5n) - hash + char) & 0xFFFFFFFFFFFFFFFFn; // 64-bit hash
    }
    // Ensure positive value
    return hash & 0x7FFFFFFFFFFFFFFFn;
  }
}
