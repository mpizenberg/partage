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
 *
 * Sync correctness note:
 * Loro operations may be buffered until a transaction is committed. Our sync layer
 * exports incremental updates using `oplogVersion()` and `export({ mode: 'update', from })`.
 * To ensure local mutations are always reflected in exported updates (and therefore reach
 * other devices), all mutations must run inside a Loro transaction.
 */

import { Loro, LoroMap } from 'loro-crdt';
import { encryptJSON, decryptJSON } from '../crypto/symmetric.js';
import type { Entry, ExpenseEntry, TransferEntry, Member } from '@partage/shared';
import { PartageDB } from '../storage/indexeddb.js';

/**
 * Metadata stored in Loro (unencrypted)
 */
interface EntryMetadata {
  id: string;
  groupId: string;
  type: 'expense' | 'transfer';

  /**
   * Entry schema/version (NOT the encryption key version).
   * This is used for entry lifecycle (modify/delete) and compatibility.
   */
  version: number;

  /**
   * Group key version used to encrypt `encryptedPayload`.
   * This enables proper key rotation: different entries may require different keys.
   */
  keyVersion: number;

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
   * Run mutations in a Loro transaction to ensure they are committed to the oplog.
   *
   * NOTE: `loro-crdt` typings (and/or runtime API) may not expose a `transact` helper.
   * We therefore use a defensive wrapper:
   * - If `transact(fn)` exists, use it.
   * - Otherwise, run `fn()` directly (best-effort).
   *
   * This keeps sync logic correct on versions of Loro that buffer ops until commit,
   * while remaining compatible with versions that apply ops immediately.
   */
  private transact(fn: () => void): void {
    const loroAny = this.loro as unknown as { transact?: (cb: () => void) => void };
    if (typeof loroAny.transact === 'function') {
      loroAny.transact(fn);
      return;
    }

    fn();
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

    // IMPORTANT: wrap mutations in a transaction so `exportFrom(versionBefore)` includes them.
    this.transact(() => {
      // Use Loro map to store the entry
      const entryMap = this.entries.setContainer(entry.id, new LoroMap()) as LoroMap;
      this.setMetadataInMap(entryMap, entryMetadata);
    });
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

    // Mark as deleted in metadata (transactional to ensure sync exports include it)
    const entryMap = this.entries.get(entryId);
    if (entryMap && entryMap instanceof LoroMap) {
      this.transact(() => {
        entryMap.set('status', 'deleted');
        entryMap.set('deletedAt', Date.now());
        entryMap.set('deletedBy', actorId);
      });

      // If there's a deletion reason, we need to re-encrypt the payload with it
      if (reason) {
        const { payload } = this.splitEntry(entry);
        const updatedPayload = { ...payload, deletionReason: reason };
        const encrypted = await encryptJSON(updatedPayload, groupKey);
        const encryptedPayload = this.serializeEncryptedData(encrypted);
        this.transact(() => {
          entryMap.set('encryptedPayload', encryptedPayload);
        });
      }
    }
  }

  /**
   * Get a single entry by ID
   *
   * Key rotation support:
   * - Newer entries store `metadata.keyVersion` (group key version used for encryption).
   * - When possible, we resolve the key from IndexedDB using that version.
   *
   * Backward compatibility:
   * - Some call sites (notably tests) pass a CryptoKey directly. If provided, we
   *   will try it first to decrypt, and only fall back to IndexedDB lookup if it fails.
   */
  async getEntry(entryId: string, groupKey: CryptoKey): Promise<Entry | null> {
    const entryMap = this.entries.get(entryId);

    // Debug: log what we got from the map
    if (!entryMap) {
      console.warn(`[LoroEntryStore] getEntry(${entryId}): entries.get() returned null/undefined`);
      return null;
    }

    // Check if it's a valid Loro container - use duck typing instead of instanceof
    // because instanceof can fail across module boundaries or after serialization
    const isLoroContainer =
      entryMap instanceof LoroMap ||
      (typeof entryMap === 'object' &&
        entryMap !== null &&
        typeof (entryMap as any).get === 'function' &&
        typeof (entryMap as any).toJSON === 'function');

    if (!isLoroContainer) {
      console.warn(
        `[LoroEntryStore] getEntry(${entryId}): got non-container type: ${typeof entryMap}, constructor: ${entryMap?.constructor?.name}`
      );
      return null;
    }

    // Cast to LoroMap for TypeScript (we've verified it has the right interface)
    const entryMapTyped = entryMap as LoroMap;
    const metadata = this.getMetadataFromMap(entryMapTyped);

    console.log(
      `[LoroEntryStore] getEntry(${entryId}): metadata.groupId=${metadata.groupId}, keyVersion=${metadata.keyVersion}, type=${metadata.type}`
    );

    // 1) Try the provided key first (helps tests and non-rotating contexts).
    // If it fails, fall back to per-entry keyVersion lookup.
    try {
      const payload = await this.decryptPayload(metadata.encryptedPayload, groupKey);
      console.log(`[LoroEntryStore] getEntry(${entryId}): decrypted successfully with provided key`);
      return this.mergeEntry(metadata, payload);
    } catch (primaryError) {
      console.log(
        `[LoroEntryStore] getEntry(${entryId}): primary decryption failed, trying keyVersion lookup. Error: ${primaryError}`
      );
    }

    // 2) Resolve the correct group key version for this entry.
    const keyString = await this.getGroupKeyString(metadata.groupId, metadata.keyVersion);
    if (!keyString) {
      console.warn(
        `[LoroEntryStore] Missing group key v${metadata.keyVersion} for group=${metadata.groupId}; ` +
          `cannot decrypt entry ${entryId}. Skipping entry.`
      );
      return null;
    }

    const key = await this.importGroupKeyFromString(keyString);

    // Decryption can legitimately fail during/after key rotation if this client
    // does not yet have the required key version. Don't let a single entry
    // prevent the rest of the entries from loading.
    try {
      const payload = await this.decryptPayload(metadata.encryptedPayload, key);
      return this.mergeEntry(metadata, payload);
    } catch (error) {
      console.warn(
        `[LoroEntryStore] Failed to decrypt entry ${entryId} (group=${metadata.groupId}, keyVersion=${metadata.keyVersion}, entryVersion=${metadata.version}). ` +
          `This usually indicates missing/rotated key material or corrupted data. Skipping entry.`,
        error
      );
      return null;
    }
  }

  /**
   * Get all active entries for a group
   */
  async getAllEntries(groupId: string, groupKey: CryptoKey): Promise<Entry[]> {
    const allEntries: Entry[] = [];
    const entriesObj = this.entries.toJSON();
    const entryIds = Object.keys(entriesObj);

    console.log(
      `[LoroEntryStore] getAllEntries: found ${entryIds.length} entry IDs in Loro map for group=${groupId}`
    );

    for (const entryId of entryIds) {
      const entry = await this.getEntry(entryId, groupKey);
      // getEntry() may return null on decryption failure; skip those entries.
      if (entry && entry.groupId === groupId) {
        allEntries.push(entry);
      } else if (entry && entry.groupId !== groupId) {
        console.warn(
          `[LoroEntryStore] Entry ${entryId} has groupId=${entry.groupId} but expected ${groupId}, skipping`
        );
      }
    }

    console.log(
      `[LoroEntryStore] getAllEntries: returning ${allEntries.length} entries for group=${groupId}`
    );

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
    this.transact(() => {
      const memberMap = this.members.setContainer(member.id, new LoroMap()) as LoroMap;
      memberMap.set('id', member.id);
      memberMap.set('name', member.name);
      if (member.publicKey) memberMap.set('publicKey', member.publicKey);
      memberMap.set('joinedAt', member.joinedAt);
      if (member.leftAt) memberMap.set('leftAt', member.leftAt);
      memberMap.set('status', member.status);
      if (member.isVirtual) memberMap.set('isVirtual', member.isVirtual);
      if (member.addedBy) memberMap.set('addedBy', member.addedBy);
    });
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

    this.transact(() => {
      if (updates.name !== undefined) memberMap.set('name', updates.name);
      if (updates.publicKey !== undefined) memberMap.set('publicKey', updates.publicKey);
      if (updates.leftAt !== undefined) memberMap.set('leftAt', updates.leftAt);
      if (updates.status !== undefined) memberMap.set('status', updates.status);
      if (updates.isVirtual !== undefined) memberMap.set('isVirtual', updates.isVirtual);
      if (updates.addedBy !== undefined) memberMap.set('addedBy', updates.addedBy);
    });
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
    // Re-acquire map handles after import to ensure they reflect the updated state
    // (same as importSnapshot - critical for seeing entries created by other peers)
    this.entries = this.loro.getMap('entries');
    this.members = this.loro.getMap('members');
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
   *
   * IMPORTANT: `keyVersion` is the group key version used to encrypt the payload.
   * We store it in CRDT metadata so that after key rotation, older entries remain decryptable.
   */
  private splitEntry(entry: Entry): {
    metadata: Omit<EntryMetadata, 'encryptedPayload'>;
    payload: EntryPayload;
  } {
    const metadata = {
      id: entry.id,
      groupId: entry.groupId,
      type: entry.type,
      version: entry.version,

      // Default keyVersion:
      // - For older entries created before we tracked keyVersion, we assume v1.
      // - For new entries, call sites should set `entry.keyVersion` (not currently part of Entry type),
      //   so we still need a way to supply it. Until all call sites are updated, we fall back to 1.
      //
      // This will be correct for pre-rotation history and avoids hard failure.
      keyVersion: (entry as any).keyVersion ?? 1,

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
  private async decryptPayload(
    encryptedPayload: string,
    groupKey: CryptoKey
  ): Promise<EntryPayload> {
    const encrypted = this.deserializeEncryptedData(encryptedPayload);
    return await decryptJSON<EntryPayload>(encrypted, groupKey);
  }

  /**
   * Load a group key (Base64 string) from IndexedDB by version.
   * Kept here to allow decrypting entries with their recorded key version.
   */
  private async getGroupKeyString(groupId: string, version: number): Promise<string | null> {
    const db = new PartageDB();
    await db.open();
    return await db.getGroupKey(groupId, version);
  }

  /**
   * Import a Base64-encoded AES-GCM key string into a CryptoKey.
   * Mirrors existing export/import helpers but is local to this class to avoid circular deps.
   */
  private async importGroupKeyFromString(keyBase64: string): Promise<CryptoKey> {
    const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
    return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
  }

  /**
   * Set metadata in a Loro map
   */
  private setMetadataInMap(map: LoroMap, metadata: EntryMetadata): void {
    map.set('id', metadata.id);
    map.set('groupId', metadata.groupId);
    map.set('type', metadata.type);
    map.set('version', metadata.version);

    // Key rotation support: store encryption key version used for this entry.
    map.set('keyVersion', metadata.keyVersion);

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
    const obj = map.toJSON() as any;

    return {
      id: obj.id as string,
      groupId: obj.groupId as string,
      type: obj.type as 'expense' | 'transfer',
      version: obj.version as number,

      // Backward compatibility: old entries won't have `keyVersion` stored.
      // Assume v1 for those entries.
      keyVersion: (obj.keyVersion as number | undefined) ?? 1,

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
      hash = ((hash << 5n) - hash + char) & 0xffffffffffffffffn; // 64-bit hash
    }
    // Ensure positive value
    return hash & 0x7fffffffffffffffn;
  }
}
