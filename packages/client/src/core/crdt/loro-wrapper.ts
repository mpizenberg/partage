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
import type {
  Entry,
  ExpenseEntry,
  TransferEntry,
  Member,
  MemberAlias,
  MemberEvent,
  MemberState,
  MemberOperationValidation,
} from '@partage/shared';
import { PartageDB } from '../storage/indexeddb.js';
import {
  computeMemberState,
  computeAllMemberStates,
  getActiveMembers as getActiveMemberStates,
  getRetiredMembers as getRetiredMemberStates,
  resolveCanonicalMemberId as resolveCanonicalMemberIdFromEvents,
  buildCanonicalIdMap,
  canRenameMember,
  canRetireMember,
  canUnretireMember,
  canReplaceMember,
  createMemberCreatedEvent,
  createMemberRenamedEvent,
  createMemberRetiredEvent,
  createMemberUnretiredEvent,
  createMemberReplacedEvent,
} from '../../domain/members/member-state.js';

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
  private memberAliases: LoroMap;
  private memberEvents: LoroMap; // New: event-based member management
  private settlementPreferences: LoroMap;
  private lastSavedVersion: any | null = null; // Track last saved version for incremental updates
  private keyCache: Map<string, CryptoKey> = new Map(); // Cache imported keys to avoid repeated crypto imports

  // Caches for computed member state (invalidated on member event changes)
  private cachedCanonicalIdMap: Map<string, string> | null = null;
  private cachedMemberStates: Map<string, MemberState> | null = null;
  private memberEventsVersion: number = 0;

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
    this.memberAliases = this.loro.getMap('memberAliases');
    this.memberEvents = this.loro.getMap('memberEvents');
    this.settlementPreferences = this.loro.getMap('settlementPreferences');
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
   * Soft delete an entry by creating a new version with status='deleted'
   * This maintains immutability - the original entry is never modified
   */
  async deleteEntry(
    entryId: string,
    actorId: string,
    groupKey: CryptoKey,
    currentKeyVersion: number,
    reason?: string
  ): Promise<string> {
    const entry = await this.getEntry(entryId, groupKey);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found`);
    }

    // Create a new version with status='deleted'
    // IMPORTANT: Don't spread the entire entry as it may contain old keyVersion
    // Instead, explicitly construct with current keyVersion
    const now = Date.now();
    const deletedEntry: Entry & { keyVersion: number } = {
      ...entry,
      id: crypto.randomUUID(), // New ID for the new version
      keyVersion: currentKeyVersion, // Use CURRENT key version for encryption
      version: entry.version + 1,
      previousVersionId: entryId,
      status: 'deleted',
      deletedAt: now,
      deletedBy: actorId,
      deletionReason: reason,
      modifiedAt: now,
      modifiedBy: actorId,
    };

    // Create as new entry (doesn't modify original)
    await this.createEntry(deletedEntry, groupKey, actorId);

    return deletedEntry.id;
  }

  /**
   * Undelete (restore) a deleted entry by creating a new version with status='active'
   * This maintains immutability - the deleted entry is never modified
   */
  async undeleteEntry(
    entryId: string,
    actorId: string,
    groupKey: CryptoKey,
    currentKeyVersion: number
  ): Promise<string> {
    const entry = await this.getEntry(entryId, groupKey);
    if (!entry) {
      throw new Error(`Entry ${entryId} not found`);
    }

    if (entry.status !== 'deleted') {
      throw new Error(`Entry ${entryId} is not deleted (status=${entry.status})`);
    }

    // Create a new version with status='active', removing deletion metadata
    // IMPORTANT: Use current keyVersion, not the one from the deleted entry
    const now = Date.now();
    const restoredEntry: Entry & { keyVersion: number } = {
      ...entry,
      id: crypto.randomUUID(), // New ID for the new version
      keyVersion: currentKeyVersion, // Use CURRENT key version for encryption
      version: entry.version + 1,
      previousVersionId: entryId,
      status: 'active',
      deletedAt: undefined,
      deletedBy: undefined,
      deletionReason: undefined,
      modifiedAt: now,
      modifiedBy: actorId,
    };

    // Create as new entry (doesn't modify original)
    await this.createEntry(restoredEntry, groupKey, actorId);

    return restoredEntry.id;
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

    // 1) Try the provided key first (helps tests and non-rotating contexts).
    // If it fails, fall back to per-entry keyVersion lookup.
    try {
      const payload = await this.decryptPayload(metadata.encryptedPayload, groupKey);
      return this.mergeEntry(metadata, payload);
    } catch {
      // Ignore decryption failure, try with versioned key below
    }

    // 2) Resolve the correct group key version for this entry (with caching).
    const key = await this.getCachedKey(metadata.groupId, metadata.keyVersion);
    if (!key) {
      console.warn(
        `[LoroEntryStore] Missing group key v${metadata.keyVersion} for group=${metadata.groupId}; ` +
          `cannot decrypt entry ${entryId}. Skipping entry.`
      );
      return null;
    }

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
   * Get all entry IDs without decrypting.
   * Useful for incremental updates where we only want to decrypt new entries.
   */
  getEntryIds(): string[] {
    const entriesObj = this.entries.toJSON();
    return Object.keys(entriesObj);
  }

  /**
   * Get entries by specific IDs.
   * Uses parallel decryption for better performance.
   * Returns entries in the same order as the input IDs (null for failed decryptions).
   */
  async getEntriesByIds(
    entryIds: string[],
    groupId: string,
    groupKey: CryptoKey
  ): Promise<Entry[]> {
    if (entryIds.length === 0) return [];

    // Parallel decryption for better performance
    const entryPromises = entryIds.map((entryId) => this.getEntry(entryId, groupKey));
    const entries = await Promise.all(entryPromises);

    // Filter to matching group and non-null entries
    return entries.filter((entry): entry is Entry => {
      if (!entry) return false;
      if (entry.groupId !== groupId) {
        console.warn(
          `[LoroEntryStore] Entry ${entry.id} has groupId=${entry.groupId} but expected ${groupId}, skipping`
        );
        return false;
      }
      return true;
    });
  }

  /**
   * Get all active entries for a group
   * Uses parallel decryption for better performance
   */
  async getAllEntries(groupId: string, groupKey: CryptoKey): Promise<Entry[]> {
    const entryIds = this.getEntryIds();
    return this.getEntriesByIds(entryIds, groupId, groupKey);
  }

  /**
   * Get current versions of all entries (excluding superseded), including deleted entries
   * An entry is superseded if another entry has previousVersionId pointing to it
   */
  async getCurrentEntries(groupId: string, groupKey: CryptoKey): Promise<Entry[]> {
    const allEntries = await this.getAllEntries(groupId, groupKey);

    // Collect all previousVersionId values - these entries have been superseded
    const supersededIds = new Set<string>();
    for (const entry of allEntries) {
      if (entry.previousVersionId) {
        supersededIds.add(entry.previousVersionId);
      }
    }

    // Filter out superseded versions, but keep both active and deleted current versions
    return allEntries.filter((entry) => !supersededIds.has(entry.id));
  }

  /**
   * Get all active (non-deleted) entries, excluding superseded versions
   * An entry is superseded if another entry has previousVersionId pointing to it
   */
  async getActiveEntries(groupId: string, groupKey: CryptoKey): Promise<Entry[]> {
    const allEntries = await this.getAllEntries(groupId, groupKey);

    // Collect all previousVersionId values - these entries have been superseded
    const supersededIds = new Set<string>();
    for (const entry of allEntries) {
      if (entry.previousVersionId) {
        supersededIds.add(entry.previousVersionId);
      }
    }

    // Filter to only active entries that haven't been superseded
    return allEntries.filter((entry) => entry.status === 'active' && !supersededIds.has(entry.id));
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

  // ==================== Member Alias Management ====================

  /**
   * Link a new member to an existing virtual member
   * Used when someone joins and claims an existing identity
   */
  addMemberAlias(alias: MemberAlias): void {
    this.transact(() => {
      const aliasMap = this.memberAliases.setContainer(alias.newMemberId, new LoroMap()) as LoroMap;
      aliasMap.set('newMemberId', alias.newMemberId);
      aliasMap.set('existingMemberId', alias.existingMemberId);
      aliasMap.set('linkedAt', alias.linkedAt);
      aliasMap.set('linkedBy', alias.linkedBy);
    });
  }

  /**
   * Get all member aliases
   */
  getMemberAliases(): MemberAlias[] {
    const aliases: MemberAlias[] = [];
    for (const id of this.memberAliases.keys()) {
      const aliasMap = this.memberAliases.get(id);
      if (!aliasMap || !(aliasMap instanceof LoroMap)) continue;
      aliases.push({
        newMemberId: aliasMap.get('newMemberId') as string,
        existingMemberId: aliasMap.get('existingMemberId') as string,
        linkedAt: aliasMap.get('linkedAt') as number,
        linkedBy: aliasMap.get('linkedBy') as string,
      });
    }
    return aliases;
  }

  /**
   * Resolve a member ID to its canonical ID (following aliases)
   * If the ID is linked to an existing member, return the existing member ID
   * Otherwise, return the original ID
   *
   * @deprecated Use resolveCanonicalMemberIdFromEvents() with getMemberEvents() instead
   */
  resolveCanonicalMemberId(memberId: string): string {
    // First try the new event-based system
    const events = this.getMemberEvents();
    if (events.length > 0) {
      return resolveCanonicalMemberIdFromEvents(memberId, events);
    }

    // Fall back to legacy alias system
    const aliases = this.getMemberAliases();
    // Check if this ID is an alias for another
    for (const alias of aliases) {
      if (alias.newMemberId === memberId) {
        return alias.existingMemberId;
      }
    }
    return memberId;
  }

  // ==================== Member Event Management (New Event-Based System) ====================

  /**
   * Add a member event to the store
   * Events are immutable - once added, they cannot be modified
   */
  addMemberEvent(event: MemberEvent): void {
    this.transact(() => {
      const eventMap = this.memberEvents.setContainer(event.id, new LoroMap()) as LoroMap;
      eventMap.set('id', event.id);
      eventMap.set('type', event.type);
      eventMap.set('memberId', event.memberId);
      eventMap.set('timestamp', event.timestamp);
      eventMap.set('actorId', event.actorId);

      // Type-specific fields
      switch (event.type) {
        case 'member_created':
          eventMap.set('name', event.name);
          eventMap.set('isVirtual', event.isVirtual);
          if (event.publicKey) eventMap.set('publicKey', event.publicKey);
          break;
        case 'member_renamed':
          eventMap.set('previousName', event.previousName);
          eventMap.set('newName', event.newName);
          break;
        case 'member_replaced':
          eventMap.set('replacedById', event.replacedById);
          break;
        // member_retired and member_unretired have no extra fields
      }
    });

    // Invalidate caches when member events change
    this.cachedCanonicalIdMap = null;
    this.cachedMemberStates = null;
    this.memberEventsVersion++;
  }

  /**
   * Get all member events from the store
   */
  getMemberEvents(): MemberEvent[] {
    const events: MemberEvent[] = [];

    for (const id of this.memberEvents.keys()) {
      const eventMap = this.memberEvents.get(id);
      if (!eventMap || !(eventMap instanceof LoroMap)) continue;

      const type = eventMap.get('type') as string;
      const baseEvent = {
        id: eventMap.get('id') as string,
        memberId: eventMap.get('memberId') as string,
        timestamp: eventMap.get('timestamp') as number,
        actorId: eventMap.get('actorId') as string,
      };

      switch (type) {
        case 'member_created':
          events.push({
            ...baseEvent,
            type: 'member_created',
            name: eventMap.get('name') as string,
            isVirtual: eventMap.get('isVirtual') as boolean,
            publicKey: eventMap.get('publicKey') as string | undefined,
          });
          break;
        case 'member_renamed':
          events.push({
            ...baseEvent,
            type: 'member_renamed',
            previousName: eventMap.get('previousName') as string,
            newName: eventMap.get('newName') as string,
          });
          break;
        case 'member_retired':
          events.push({ ...baseEvent, type: 'member_retired' });
          break;
        case 'member_unretired':
          events.push({ ...baseEvent, type: 'member_unretired' });
          break;
        case 'member_replaced':
          events.push({
            ...baseEvent,
            type: 'member_replaced',
            replacedById: eventMap.get('replacedById') as string,
          });
          break;
      }
    }

    return events;
  }

  /**
   * Get computed state for a specific member from events
   */
  getMemberState(memberId: string): MemberState | null {
    const events = this.getMemberEvents();
    return computeMemberState(memberId, events);
  }

  /**
   * Get computed states for all members from events.
   * Uses caching to avoid recomputation when member events haven't changed.
   */
  getAllMemberStates(): Map<string, MemberState> {
    const currentCount = this.getMemberEventsCount();
    if (this.cachedMemberStates && this.memberEventsVersion === currentCount) {
      return this.cachedMemberStates;
    }
    const events = this.getMemberEvents();
    this.cachedMemberStates = computeAllMemberStates(events);
    this.memberEventsVersion = currentCount;
    return this.cachedMemberStates;
  }

  /**
   * Get the count of member events (for cache invalidation).
   */
  private getMemberEventsCount(): number {
    // Use the size of the memberEvents map as a simple version indicator
    let count = 0;
    for (const _id of this.memberEvents.keys()) {
      count++;
    }
    return count;
  }

  /**
   * Get all active members (computed from events)
   */
  getActiveMemberStates(): MemberState[] {
    const events = this.getMemberEvents();
    return getActiveMemberStates(events);
  }

  /**
   * Get all retired members (computed from events)
   */
  getRetiredMemberStates(): MemberState[] {
    const events = this.getMemberEvents();
    return getRetiredMemberStates(events);
  }

  /**
   * Build a map of canonical member ID resolutions.
   * Uses caching to avoid recomputation when member events haven't changed.
   */
  getCanonicalIdMap(): Map<string, string> {
    const currentCount = this.getMemberEventsCount();
    if (this.cachedCanonicalIdMap && this.memberEventsVersion === currentCount) {
      return this.cachedCanonicalIdMap;
    }
    const events = this.getMemberEvents();
    this.cachedCanonicalIdMap = buildCanonicalIdMap(events);
    this.memberEventsVersion = currentCount;
    return this.cachedCanonicalIdMap;
  }

  /**
   * Efficiently check if a member ID is known (exists in any member event)
   * This is much faster than computing full member states - O(n) with early exit
   *
   * @param memberId - The member ID to check
   * @returns true if any member event references this ID, false otherwise
   */
  isMemberKnown(memberId: string): boolean {
    // Iterate through member events and return true as soon as we find a match
    for (const eventMap of this.memberEvents.values()) {
      if (!eventMap || !(eventMap instanceof LoroMap)) continue;

      const eventMemberId = eventMap.get('memberId');
      if (eventMemberId === memberId) {
        return true; // Found it! Short-circuit
      }
    }
    return false; // Not found after checking all events
  }

  // ==================== Member Event Operations (High-Level API) ====================

  /**
   * Create a new member via event
   */
  createMember(
    memberId: string,
    name: string,
    actorId: string,
    options: { publicKey?: string; isVirtual: boolean }
  ): MemberEvent {
    const event = createMemberCreatedEvent(memberId, name, actorId, options);
    this.addMemberEvent(event);
    return event;
  }

  /**
   * Rename a member via event
   * Returns the event if successful, or validation result if invalid
   */
  renameMemberViaEvent(
    memberId: string,
    newName: string,
    actorId: string
  ): MemberEvent | MemberOperationValidation {
    const events = this.getMemberEvents();
    const validation = canRenameMember(memberId, events);
    if (!validation.valid) {
      return validation;
    }

    const state = computeMemberState(memberId, events);
    const previousName = state!.name;

    const event = createMemberRenamedEvent(memberId, previousName, newName, actorId);
    this.addMemberEvent(event);
    return event;
  }

  /**
   * Retire a member via event
   * Returns the event if successful, or validation result if invalid
   */
  retireMember(memberId: string, actorId: string): MemberEvent | MemberOperationValidation {
    const events = this.getMemberEvents();
    const validation = canRetireMember(memberId, events);
    if (!validation.valid) {
      return validation;
    }

    const event = createMemberRetiredEvent(memberId, actorId);
    this.addMemberEvent(event);
    return event;
  }

  /**
   * Unretire a member via event
   * Returns the event if successful, or validation result if invalid
   */
  unretireMember(memberId: string, actorId: string): MemberEvent | MemberOperationValidation {
    const events = this.getMemberEvents();
    const validation = canUnretireMember(memberId, events);
    if (!validation.valid) {
      return validation;
    }

    const event = createMemberUnretiredEvent(memberId, actorId);
    this.addMemberEvent(event);
    return event;
  }

  /**
   * Replace a member (alias) via event
   * Returns the event if successful, or validation result if invalid
   */
  replaceMember(
    memberId: string,
    replacedById: string,
    actorId: string
  ): MemberEvent | MemberOperationValidation {
    const events = this.getMemberEvents();
    const validation = canReplaceMember(memberId, replacedById, events);
    if (!validation.valid) {
      return validation;
    }

    const event = createMemberReplacedEvent(memberId, replacedById, actorId);
    this.addMemberEvent(event);
    return event;
  }

  /**
   * Check if an event result is a validation error
   */
  static isValidationError(
    result: MemberEvent | MemberOperationValidation
  ): result is MemberOperationValidation {
    return 'valid' in result && !result.valid;
  }

  // ==================== Settlement Preferences ====================

  /**
   * Set settlement preference for a user
   * Latest preference simply overrides any previous ones
   * To delete a preference, pass an empty preferredRecipients array
   */
  setSettlementPreference(userId: string, preferredRecipients: string[]): void {
    this.transact(() => {
      if (preferredRecipients.length === 0) {
        // Delete the preference by removing from map
        this.settlementPreferences.delete(userId);
      } else {
        // Store as a Loro list container
        const prefList = this.settlementPreferences.setContainer(userId, new LoroMap()) as LoroMap;
        // Store the array as a JSON string for simplicity
        // (Loro lists can be complex, and we don't need CRDT list operations for preferences)
        prefList.set('preferredRecipients', JSON.stringify(preferredRecipients));
        prefList.set('updatedAt', Date.now());
      }
    });
  }

  /**
   * Get all settlement preferences from the CRDT
   */
  getSettlementPreferences(): Array<{ userId: string; preferredRecipients: string[] }> {
    const preferences: Array<{ userId: string; preferredRecipients: string[] }> = [];
    const userIds = this.settlementPreferences.keys();

    for (const userId of userIds) {
      const prefMap = this.settlementPreferences.get(userId);
      if (!prefMap || !(prefMap instanceof LoroMap)) continue;

      const recipientsJson = prefMap.get('preferredRecipients') as string | undefined;
      if (!recipientsJson) continue;

      try {
        const preferredRecipients = JSON.parse(recipientsJson) as string[];
        preferences.push({ userId, preferredRecipients });
      } catch (err) {
        console.error(`Failed to parse settlement preference for ${userId}:`, err);
      }
    }

    return preferences;
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
    this.memberAliases = this.loro.getMap('memberAliases');
    this.memberEvents = this.loro.getMap('memberEvents');
    this.settlementPreferences = this.loro.getMap('settlementPreferences');
    this.lastSavedVersion = this.loro.oplogVersion(); // Mark as saved

    // Invalidate member caches since snapshot may have different member events
    this.cachedCanonicalIdMap = null;
    this.cachedMemberStates = null;
  }

  /**
   * Export incremental update since last save
   * Returns empty Uint8Array if no changes since last save
   */
  exportIncrementalUpdate(): { updateData: Uint8Array; version: any } {
    const currentVersion = this.loro.oplogVersion();
    const updateData = this.lastSavedVersion
      ? this.loro.export({ mode: 'update', from: this.lastSavedVersion })
      : new Uint8Array(0);
    return { updateData, version: currentVersion };
  }

  /**
   * Mark current version as saved (updates lastSavedVersion tracker)
   */
  markAsSaved(): void {
    this.lastSavedVersion = this.loro.oplogVersion();
  }

  /**
   * Reset saved version (after consolidation)
   */
  resetSavedVersion(): void {
    this.lastSavedVersion = this.loro.oplogVersion();
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
    this.memberAliases = this.loro.getMap('memberAliases');
    this.memberEvents = this.loro.getMap('memberEvents');
    this.settlementPreferences = this.loro.getMap('settlementPreferences');

    // Invalidate member caches since update may have new member events
    this.cachedCanonicalIdMap = null;
    this.cachedMemberStates = null;
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
   * Load a group key (Base64 string) from IndexedDB.
   * Note: With simplified single-key approach, version parameter is ignored.
   */
  private async getGroupKeyString(groupId: string, _version?: number): Promise<string | null> {
    const db = new PartageDB();
    await db.open();
    return await db.getGroupKey(groupId);
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
   * Get a cached CryptoKey for a group/version combination.
   * Avoids repeated crypto.subtle.importKey() calls which are expensive.
   * Returns null if the key is not available in IndexedDB.
   */
  private async getCachedKey(groupId: string, version: number): Promise<CryptoKey | null> {
    const cacheKey = `${groupId}:${version}`;

    // Check cache first
    if (this.keyCache.has(cacheKey)) {
      return this.keyCache.get(cacheKey)!;
    }

    // Load from IndexedDB and import
    const keyString = await this.getGroupKeyString(groupId, version);
    if (!keyString) {
      return null;
    }

    const key = await this.importGroupKeyFromString(keyString);
    this.keyCache.set(cacheKey, key);
    return key;
  }

  /**
   * Clear the key cache (useful when keys are rotated or user logs out)
   */
  clearKeyCache(): void {
    this.keyCache.clear();
  }

  /**
   * Clear all caches (keys, canonical ID map, member states).
   * Useful on key rotation or when forcing full recomputation.
   */
  clearAllCaches(): void {
    this.keyCache.clear();
    this.cachedCanonicalIdMap = null;
    this.cachedMemberStates = null;
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
