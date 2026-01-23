import {
  createContext,
  useContext,
  Component,
  JSX,
  createSignal,
  onMount,
  onCleanup,
  Accessor,
  createMemo,
  createEffect,
} from 'solid-js';
import { PartageDB, getDB } from '../../core/storage/indexeddb';
import { LoroEntryStore } from '../../core/crdt/loro-wrapper';
import {
  calculateBalances,
  generateSettlementPlan,
} from '../../domain/calculations/balance-calculator';
import { filterActivities } from '../../domain/calculations/activity-generator';
import { IncrementalStateManager } from '../../domain/state/incremental-state-manager';
import { SyncManager, type SyncState } from '../../core/sync';
import { SnapshotManager } from '../../core/storage/snapshot-manager';
import { pbClient, PocketBaseClient } from '../../api';
import {
  generateKeypair,
  exportKeypair,
  generateSigningKeypair,
  exportSigningKeypair,
  generateSymmetricKey,
  exportSymmetricKey,
  importSymmetricKey,
} from '../../core/crypto';
import type {
  SerializedKeypair,
  Group,
  Member,
  Entry,
  ExpenseEntry,
  TransferEntry,
  ExpenseCategory,
  Balance,
  SettlementPlan,
  GroupSettings,
  Activity,
  ActivityFilter,
  EntryFilter,
  GroupLink,
  MemberPaymentInfo,
  GroupMetadataState,
} from '@partage/shared';
import { DEFAULT_GROUP_SETTINGS } from '@partage/shared';
import { generateInviteLink } from '../../domain/invitations/invite-manager';
import { publishNotification } from '../../domain/notifications/ntfy-client';
import type { PoWSolution } from '../../core/pow/proof-of-work';

// Expense form data interface
export interface ExpenseFormData {
  description: string;
  amount: number;
  currency: string;
  date: number;
  category?: ExpenseCategory;
  location?: string;
  notes?: string;
  payers: Array<{ memberId: string; amount: number }>;
  beneficiaries: Array<{
    memberId: string;
    splitType: 'shares' | 'exact';
    shares?: number;
    amount?: number;
  }>;
  defaultCurrencyAmount?: number;
}

// Transfer form data interface
export interface TransferFormData {
  amount: number;
  currency: string;
  from: string;
  to: string;
  date: number;
  notes?: string;
  defaultCurrencyAmount?: number;
}

// App context interface
interface AppContextValue {
  // Core services
  db: PartageDB;
  loroStore: Accessor<LoroEntryStore | null>;
  syncManager: Accessor<SyncManager | null>;

  // User identity (local crypto keypair)
  identity: Accessor<SerializedKeypair | null>;
  initializeIdentity: () => Promise<void>;

  // Groups
  groups: Accessor<Group[]>;
  activeGroup: Accessor<Group | null>;
  createGroup: (
    name: string,
    currency: string,
    members: Member[],
    powSolution: PoWSolution,
    myUserName: string,
    metadata?: {
      subtitle?: string;
      description?: string;
      links?: GroupLink[];
    }
  ) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
  deselectGroup: () => void;
  getActiveGroupKey: () => Promise<CryptoKey | null>;

  // Members for active group
  members: Accessor<Member[]>;
  addVirtualMember: (name: string) => Promise<void>;
  renameMember: (memberId: string, newName: string) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;

  // Entries (derived from Loro)
  entries: Accessor<Entry[]>;
  conflictingEntryIds: Accessor<Set<string>>; // Entries with concurrent edits (same rootId)
  showDeleted: Accessor<boolean>;
  setShowDeleted: (show: boolean) => void;
  entryFilter: Accessor<EntryFilter>;
  setEntryFilter: (filter: EntryFilter) => void;
  addExpense: (data: ExpenseFormData) => Promise<void>;
  addTransfer: (data: TransferFormData) => Promise<void>;
  modifyExpense: (originalId: string, data: ExpenseFormData) => Promise<void>;
  modifyTransfer: (originalId: string, data: TransferFormData) => Promise<void>;
  deleteEntry: (entryId: string, reason?: string) => Promise<void>;
  undeleteEntry: (entryId: string) => Promise<void>;

  // Entry editing state
  editingEntry: Accessor<Entry | null>;
  setEditingEntry: (entry: Entry | null) => void;

  // Balances (derived from entries)
  balances: Accessor<Map<string, Balance>>;
  settlementPlan: Accessor<SettlementPlan>;
  getGroupBalance: (groupId: string) => Promise<Balance | null>;

  // Activities (derived from entries and members)
  activities: Accessor<Activity[]>;
  activityFilter: Accessor<ActivityFilter>;
  setActivityFilter: (filter: ActivityFilter) => void;

  // Invitations & Multi-User (Simplified)
  createInvitation: (groupId: string) => Promise<{ inviteLink: string }>;
  joinGroupWithKey: (
    groupId: string,
    groupKeyBase64: string,
    memberName: string,
    existingMemberId?: string
  ) => Promise<void>;

  // Sync state and controls
  syncState: Accessor<SyncState>;
  manualSync: () => Promise<void>;
  toggleAutoSync: () => void;

  // Settlement preferences
  updateSettlementPreferences: (userId: string, preferredRecipients: string[]) => Promise<void>;
  preferencesVersion: Accessor<number>; // Version counter to force reactivity

  // Group and member metadata
  groupMetadata: Accessor<GroupMetadataState>;
  getMemberMetadata: (memberId: string) => Promise<{
    phone?: string;
    payment?: MemberPaymentInfo;
    info?: string;
  } | null>;
  updateGroupMetadata: (metadata: {
    subtitle?: string;
    description?: string;
    links?: GroupLink[];
  }) => Promise<void>;
  updateMemberMetadata: (
    memberId: string,
    metadata: {
      phone?: string;
      payment?: MemberPaymentInfo;
      info?: string;
    }
  ) => Promise<void>;

  // Export/Import/Delete
  exportGroups: (groupIds?: string[]) => Promise<string>;
  importGroups: (exportedData: string) => Promise<ImportAnalysis>;
  confirmImport: (importData: ExportData, mergeExisting: boolean) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;

  // UI state
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  clearError: () => void;
}

// Export data format
export interface ExportData {
  version: string; // Export format version
  exportedAt: number;
  groups: GroupExport[];
}

export interface GroupExport {
  group: Group;
  key: string; // Single group key (Base64-encoded)
  loroSnapshot: Uint8Array;
}

// Import analysis result
export interface ImportAnalysis {
  groups: Array<{
    group: Group;
    exists: boolean;
    relationship: 'new' | 'local_subset' | 'import_subset' | 'diverged';
    localVersion?: string; // Loro version vector
    importVersion?: string; // Loro version vector
  }>;
  exportData: ExportData;
}

/**
 * Helper function to check if a user is already a member of a group
 * Returns true if the user can join/rejoin, false if already a member
 *
 * @param groupId - The group ID to check
 * @param groups - Current local groups list
 * @param loroStore - Loro store with updates applied
 * @param userPublicKeyHash - Current user's public key hash
 * @returns true if user can join, false if already a member
 * @throws Error if user is already a member (for AppContext usage)
 */
export function checkCanJoinGroup(
  groupId: string,
  groups: Group[],
  loroStore: LoroEntryStore,
  userPublicKeyHash: string
): boolean {
  // Check if we already have this group
  const existingGroup = groups.find((g) => g.id === groupId);
  if (!existingGroup) {
    // Group doesn't exist locally - can join
    return true;
  }

  // Group exists locally - check if current identity is actually a member
  const isCurrentUserMember = loroStore.isMemberKnown(userPublicKeyHash);
  if (isCurrentUserMember) {
    // User is already a member - cannot join
    return false;
  }

  return true;
}

// Create context
const AppContext = createContext<AppContextValue>();

// Provider component
export const AppProvider: Component<{ children: JSX.Element }> = (props) => {
  const db = getDB();

  // Snapshot manager for incremental updates
  const [snapshotManager] = createSignal(new SnapshotManager(db, 50)); // Consolidate every 50 updates

  // Incremental state manager for CQRS pattern
  const [stateManager] = createSignal(new IncrementalStateManager());

  // Core state
  const [identity, setIdentity] = createSignal<SerializedKeypair | null>(null);
  const [groups, setGroups] = createSignal<Group[]>([]);
  const [activeGroup, setActiveGroup] = createSignal<Group | null>(null);
  const [loroStore, setLoroStore] = createSignal<LoroEntryStore | null>(null);
  const [syncManager, setSyncManager] = createSignal<SyncManager | null>(null);

  // Derived state
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [conflictingEntryIds, setConflictingEntryIds] = createSignal<Set<string>>(new Set());
  const [balances, setBalances] = createSignal<Map<string, Balance>>(new Map());
  const [preferencesVersion, setPreferencesVersion] = createSignal(0);

  // Show deleted entries toggle
  const [showDeleted, setShowDeleted] = createSignal(false);

  // Entry filter state
  const [entryFilter, setEntryFilter] = createSignal<EntryFilter>({});

  // Entry editing state
  const [editingEntry, setEditingEntry] = createSignal<Entry | null>(null);

  // Activities state
  const [allActivities, setAllActivities] = createSignal<Activity[]>([]);
  const [activityFilter, setActivityFilter] = createSignal<ActivityFilter>({});

  // Group metadata (decrypted) - loaded when group is selected
  const [groupMetadata, setGroupMetadata] = createSignal<GroupMetadataState>({ links: [] });

  // Phase 5: Invitations & Multi-User

  // Sync state
  const [syncState, setSyncState] = createSignal<SyncState>({
    status: 'idle',
    lastSyncTimestamp: null,
    lastError: null,
    isOnline: navigator.onLine,
    activeSubscriptions: 0,
  });
  const [autoSyncEnabled, setAutoSyncEnabled] = createSignal(true);

  // UI state
  const [isLoading, setIsLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  // Members for active group (both active and retired, excluding replaced members)
  // Uses the event-based system exclusively
  const members = createMemo(() => {
    const group = activeGroup();
    if (!group) {
      return [];
    }
    const store = loroStore();
    if (!store) {
      // No store yet, return cached members from group
      const membersList = group.activeMembers || [];
      return membersList;
    }

    // Get active members
    const activeStates = store.getActiveMemberStates();
    const activeMembersList: Member[] = activeStates.map((state) => ({
      id: state.id,
      name: state.name,
      publicKey: state.publicKey,
      joinedAt: state.createdAt,
      leftAt: undefined,
      status: 'active' as const,
      isVirtual: state.isVirtual,
      addedBy: state.createdBy,
    }));

    // Get retired members (departed but not replaced)
    const retiredStates = store.getRetiredMemberStates();
    const retiredMembersList: Member[] = retiredStates.map((state) => ({
      id: state.id,
      name: state.name,
      publicKey: state.publicKey,
      joinedAt: state.createdAt,
      leftAt: state.retiredAt,
      status: 'departed' as const,
      isVirtual: state.isVirtual,
      addedBy: state.createdBy,
    }));

    const membersList = [...activeMembersList, ...retiredMembersList];
    return membersList;
  });

  // Settlement plan (memoized) - uses preferences from Loro
  const settlementPlan = createMemo(() => {
    const currentBalances = balances();
    if (currentBalances.size === 0) {
      return { transactions: [], totalTransactions: 0 };
    }
    const store = loroStore();
    // Read version to ensure recalculation when preferences change
    preferencesVersion();
    const preferences = store?.getSettlementPreferences() || [];
    return generateSettlementPlan(currentBalances, preferences);
  });

  // Filtered activities (memoized)
  const activities = createMemo(() => {
    const filter = activityFilter();
    const all = allActivities();
    if (Object.keys(filter).length === 0) {
      return all;
    }
    return filterActivities(all, filter);
  });

  // Refresh entries when showDeleted changes
  createEffect(() => {
    const group = activeGroup();
    if (group) {
      // Trigger refresh when showDeleted changes
      showDeleted();
      refreshEntries(group.id, group.currentKeyVersion);
    }
  });

  // Initialize database and load data
  onMount(async () => {
    try {
      setIsLoading(true);

      // Open database
      await db.open();

      // Load user identity
      const storedIdentity = await db.getUserKeypair();
      setIdentity(storedIdentity?.keypair || null);

      // Load all groups
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);

      // Check server connectivity
      await pbClient.healthCheck();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize app');
      console.error('Initialization error:', err);
    } finally {
      setIsLoading(false);
    }
  });

  // Consolidate on idle (when user switches tabs or minimizes browser)
  onMount(() => {
    const handleVisibilityChange = async () => {
      if (document.hidden && activeGroup()) {
        const store = loroStore();
        if (store) {
          await snapshotManager()
            .consolidateOnIdle(activeGroup()!.id, store)
            .catch((err) => {
              console.error('[AppContext] Idle consolidation failed:', err);
            });
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    onCleanup(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    });
  });

  // Listen for online/offline events to update syncState
  onMount(() => {
    const handleOnline = () => {
      setSyncState((prev) => ({ ...prev, isOnline: true }));
    };
    const handleOffline = () => {
      setSyncState((prev) => ({ ...prev, isOnline: false }));
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    onCleanup(() => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    });
  });

  // Cleanup on unmount
  onCleanup(async () => {
    const manager = syncManager();
    if (manager) {
      await manager.destroy();
    }
  });

  // Initialize identity (first-time setup)
  const initializeIdentity = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Generate keypairs
      const keypair = await generateKeypair();
      const signingKeypair = await generateSigningKeypair();

      // Export for storage
      const exportedKeypair = await exportKeypair(keypair);
      const exportedSigningKeypair = await exportSigningKeypair(signingKeypair);

      // Save to database
      await db.saveUserKeypair(exportedKeypair, exportedSigningKeypair);

      // Update state
      setIdentity(exportedKeypair);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate identity');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Create new group
  // Requires a PoW solution to prevent spam
  const createGroup = async (
    name: string,
    currency: string,
    virtualMembers: Member[],
    powSolution: PoWSolution,
    myUserName: string,
    metadata?: {
      subtitle?: string;
      description?: string;
      links?: GroupLink[];
    }
  ) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found. Please initialize identity first.');
      }

      // Generate group key first (needed for password derivation)
      const groupKey = await generateSymmetricKey();
      const exportedKey = await exportSymmetricKey(groupKey);

      // Create group on server to get server-generated ID
      // PoW is required and validated by server hook
      let groupId: string;
      const createdAt = Date.now();

      if (navigator.onLine) {
        try {
          const serverGroup = await pbClient.createGroup(
            {
              name,
              createdAt,
              createdBy: currentIdentity.publicKeyHash,
            },
            powSolution
          );
          groupId = serverGroup.id;

          // Create group user account (password derived from group key)
          // No PoW needed - server validates that groupId exists
          await pbClient.createGroupUser(groupId, exportedKey);

          // Authenticate as group account for subsequent API calls
          await pbClient.authenticateAsGroup(groupId, exportedKey);
        } catch (error) {
          console.error('[AppContext] Failed to create group on server:', error);
          throw new Error('Failed to create group on server. Please check your connection.');
        }
      } else {
        // Offline: use UUID (will need special handling for sync later)
        groupId = crypto.randomUUID();
      }

      // Default group settings
      const defaultSettings: GroupSettings = {
        anyoneCanAddEntries: true,
        anyoneCanModifyEntries: true,
        anyoneCanDeleteEntries: true,
        anyoneCanInvite: true,
        anyoneCanShareKeys: true,
      };

      // Create group object
      const group: Group = {
        id: groupId,
        name,
        defaultCurrency: currency,
        createdAt,
        createdBy: currentIdentity.publicKeyHash,
        currentKeyVersion: 1,
        settings: defaultSettings,
        activeMembers: [
          // Add current user as first member
          {
            id: currentIdentity.publicKeyHash,
            name: myUserName,
            publicKey: currentIdentity.publicKey,
            joinedAt: Date.now(),
            status: 'active' as const,
            isVirtual: false,
          },
          // Add virtual members
          ...virtualMembers,
        ],
      };

      // Initialize Loro store and add initial members using event-based system
      const newLoroStore = new LoroEntryStore(currentIdentity.publicKeyHash);

      // Add creator as first member via event
      newLoroStore.createMember(
        currentIdentity.publicKeyHash,
        myUserName,
        currentIdentity.publicKeyHash,
        { publicKey: currentIdentity.publicKey, isVirtual: false }
      );

      // Add virtual members to Loro via events
      for (const member of virtualMembers) {
        newLoroStore.createMember(member.id, member.name, currentIdentity.publicKeyHash, {
          isVirtual: true,
        });
      }

      // Add initial group metadata if provided (encrypted)
      if (metadata && (metadata.subtitle || metadata.description || metadata.links?.length)) {
        await newLoroStore.updateGroupMetadata(
          groupId,
          metadata,
          currentIdentity.publicKeyHash,
          groupKey
        );
      }

      // Save to database
      await db.saveGroup(group);
      await db.saveGroupKey(groupId, exportedKey);

      const initialSnapshot = newLoroStore.exportSnapshot();
      const initialVersion = newLoroStore.getVersion();
      await db.saveLoroSnapshot(groupId, initialSnapshot, initialVersion);
      newLoroStore.markAsSaved(); // Mark as saved for future incremental updates

      // Push initial Loro state (with members) to server
      // NOTE: We use exportSnapshot() for the initial state because:
      // 1. The document is new and has no prior version to diff from
      // 2. Loro's import() handles both snapshots and incremental updates
      // 3. Other clients will receive the complete initial state
      if (navigator.onLine) {
        try {
          const tempManager = new SyncManager({
            loroStore: newLoroStore,
            storage: db,
            apiClient: pbClient,
            enableAutoSync: false, // Don't auto-sync yet
          });

          // Export the initial state as a snapshot (Loro handles this correctly on import)
          const updateBytes = newLoroStore.exportSnapshot();
          await tempManager.pushUpdate(groupId, currentIdentity.publicKeyHash, updateBytes);

          // Destroy temporary manager (selectGroup will create a proper one)
          await tempManager.destroy();
        } catch (pushErr) {
          console.warn('[AppContext] Failed to push initial state, will sync later:', pushErr);
        }
      }

      // Update groups list
      const updatedGroups = await db.getAllGroups();
      setGroups(updatedGroups);

      // Auto-select the new group
      await selectGroup(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Select group and load its data
  const selectGroup = async (groupId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      // Clear previous group's state cache
      stateManager().clear();

      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found');
      }

      // Get group from database
      const group = await db.getGroup(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      // Re-authenticate as group account for API access (password derived from key)
      const groupKeyBase64 = await db.getGroupKey(groupId);
      if (groupKeyBase64 && navigator.onLine) {
        try {
          await pbClient.authenticateAsGroup(groupId, groupKeyBase64);
        } catch (authErr) {
          console.warn(
            '[AppContext] Failed to authenticate as group, some features may not work:',
            authErr
          );
        }
      }

      // Load Loro snapshot + incremental updates (and consolidate)
      const store = new LoroEntryStore(currentIdentity.publicKeyHash);
      await snapshotManager().load(groupId, store);

      // Sync members from Loro to group object (using event-based system or legacy fallback)
      const activeMembersList = getAllMembersForCache(store);
      const updatedGroup = { ...group, activeMembers: activeMembersList };
      if (activeMembersList.length > 0) {
        await db.saveGroup(updatedGroup);
      }

      setLoroStore(store);
      setActiveGroup(updatedGroup);

      // Initialize sync manager
      const manager = new SyncManager({
        loroStore: store,
        storage: db,
        apiClient: pbClient,
        enableAutoSync: autoSyncEnabled(),
        onUpdate: async (updatedGroupId) => {
          // Refresh entries and members when updates are received
          if (updatedGroupId === groupId) {
            await refreshEntries(groupId, group.currentKeyVersion);

            // Update members from Loro (using event-based system or legacy fallback)
            const filteredMembers = getAllMembersForCache(store);
            const refreshedGroup = { ...group, activeMembers: filteredMembers };
            await db.saveGroup(refreshedGroup);
            setActiveGroup(refreshedGroup);

            // Refresh group metadata after sync
            if (groupKeyBase64) {
              try {
                const groupKey = await importSymmetricKey(groupKeyBase64);
                const metadata = await store.getGroupMetadata(groupId, groupKey);
                setGroupMetadata(metadata);
              } catch (metaErr) {
                console.warn('[AppContext] Failed to refresh group metadata:', metaErr);
              }
            }

            // IMPORTANT: Trigger reactive update for settlement preferences and other Loro data
            // Increment version counter to force settlement plan recalculation
            setPreferencesVersion((v) => v + 1);
            setLoroStore(store);
          }
        },
      });
      setSyncManager(manager);

      // Load entries and calculate balances (before sync)
      await refreshEntries(groupId, group.currentKeyVersion);

      // Load decrypted group metadata
      if (groupKeyBase64) {
        try {
          const groupKey = await importSymmetricKey(groupKeyBase64);
          const metadata = await store.getGroupMetadata(groupId, groupKey);
          setGroupMetadata(metadata);
        } catch (metaErr) {
          console.warn('[AppContext] Failed to load group metadata:', metaErr);
          setGroupMetadata({ links: [] });
        }
      }

      // Perform initial sync if online
      if (navigator.onLine && autoSyncEnabled()) {
        try {
          await manager.initialSync(groupId, currentIdentity.publicKeyHash);

          // Subscribe to real-time updates
          await manager.subscribeToGroup(groupId, currentIdentity.publicKeyHash);

          // Refresh entries after sync
          await refreshEntries(groupId, group.currentKeyVersion);

          // Sync members from Loro after sync (in case new members were added)
          // Using event-based system or legacy fallback
          const filteredSyncedMembers = getAllMembersForCache(store);
          const syncedGroup = { ...updatedGroup, activeMembers: filteredSyncedMembers };
          if (filteredSyncedMembers.length > 0) {
            await db.saveGroup(syncedGroup);
            setActiveGroup(syncedGroup);
          }

          // Update sync state
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Sync failed, continuing in offline mode:', syncError);
          setSyncState(manager.getState());
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Deselect active group
  const deselectGroup = async () => {
    // Cleanup sync manager
    const manager = syncManager();
    if (manager) {
      await manager.destroy();
      setSyncManager(null);
    }

    // Clear incremental state manager cache
    stateManager().clear();

    setActiveGroup(null);
    setLoroStore(null);
    setEntries([]);
    setBalances(new Map());
    setAllActivities([]);
    setSyncState({
      status: 'idle',
      lastSyncTimestamp: null,
      lastError: null,
      isOnline: navigator.onLine,
      activeSubscriptions: 0,
    });
  };

  // Get the cryptographic key for the active group
  const getActiveGroupKey = async (): Promise<CryptoKey | null> => {
    const group = activeGroup();
    if (!group) return null;

    const keyString = await db.getGroupKey(group.id);
    if (!keyString) return null;

    return importSymmetricKey(keyString);
  };

  // Refresh entries from Loro store using IncrementalStateManager
  const refreshEntries = async (groupId: string, _keyVersion: number) => {
    try {
      const store = loroStore();
      if (!store) return;

      // Best-effort: pass the current group key as the first decryption attempt.
      // Proper rotation support is implemented in the store by falling back to the
      // per-entry `keyVersion` lookup when this key doesn't work.
      const keyString = await db.getGroupKey(groupId);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);
      const currentMembers = members();

      // Use IncrementalStateManager for CQRS pattern with caching
      const manager = stateManager();
      const { state, result } = await manager.handleUpdate(
        store,
        groupKey,
        groupId,
        currentMembers
      );

      // Update signals only if data changed
      // Create new references to trigger SolidJS reactivity
      if (result.balancesChanged) {
        setBalances(new Map(state.balances));
      }
      if (result.activitiesChanged) {
        setAllActivities([...state.activities]);
      }

      // Update conflict detection (entries with concurrent edits)
      const currentConflicts = conflictingEntryIds();
      const newConflicts = state.conflictingEntryIds;
      const conflictsChanged =
        currentConflicts.size !== newConflicts.size ||
        [...newConflicts].some((id) => !currentConflicts.has(id));
      if (conflictsChanged) {
        setConflictingEntryIds(new Set(newConflicts));
      }

      // Update entries list with showDeleted filter
      // Use cached state from IncrementalStateManager
      if (showDeleted()) {
        // Get current (non-superseded) entries from cache
        const currentEntries = Array.from(state.entriesById.values()).filter(
          (e) => !state.supersededEntryIds.has(e.id)
        );
        setEntries(currentEntries);
      } else {
        const activeEntries = Array.from(state.activeEntryIds)
          .map((id) => state.entriesById.get(id)!)
          .filter(Boolean);
        setEntries(activeEntries);
      }
    } catch (err) {
      console.error('Failed to refresh entries:', err);
      setError(err instanceof Error ? err.message : 'Failed to load entries');
    }
  };

  // Incremental refresh after adding/modifying/deleting a single entry
  // Now delegates to refreshEntries() which uses IncrementalStateManager internally
  // The state manager handles incremental updates via commutative balance deltas
  const refreshEntriesIncremental = async (
    groupId: string,
    _newEntry: Entry,
    _previousEntry: Entry | null,
    _operationType: 'add' | 'modify' | 'delete' | 'undelete'
  ) => {
    const group = activeGroup();
    if (group) {
      await refreshEntries(groupId, group.currentKeyVersion);
    }
  };

  // Add expense
  const addExpense = async (data: ExpenseFormData) => {
    try {
      // Note: Not setting global isLoading to avoid unmounting GroupViewScreen
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Create expense entry
      // Note: keyVersion is always 1 in the simplified single-key model
      const entry: ExpenseEntry & { keyVersion: number } = {
        id: crypto.randomUUID(),
        groupId: group.id,
        type: 'expense',
        version: 1,
        keyVersion: group.currentKeyVersion,
        // rootId is undefined for new entries (they are their own root)
        createdAt: Date.now(),
        createdBy: currentIdentity.publicKeyHash,
        status: 'active',
        amount: data.amount,
        currency: data.currency,
        date: data.date,
        description: data.description,
        category: data.category,
        location: data.location,
        notes: data.notes,
        payers: data.payers,
        beneficiaries: data.beneficiaries,
        // For multi-currency support (Phase 6)
        defaultCurrencyAmount: data.defaultCurrencyAmount ?? data.amount,
      };

      // Get group key
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get version BEFORE adding entry
      const versionBefore = store.getVersion();

      // Add to Loro
      await store.createEntry(entry, groupKey, currentIdentity.publicKeyHash);

      // Get the Loro update to push to server
      const manager = syncManager();
      if (manager && autoSyncEnabled()) {
        try {
          // Export incremental update (changes since versionBefore)
          const updateBytes = store.exportFrom(versionBefore);

          // Push to server
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );

          // Update sync state
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync expense, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI incrementally (faster than full regeneration)
      await refreshEntriesIncremental(group.id, entry, null, 'add');

      // Publish NTFY notification for other users
      publishNotification({
        groupId: group.id,
        groupName: group.name,
        groupKey,
        actorId: currentIdentity.publicKeyHash,
      }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense');
      throw err;
    }
  };

  // Add transfer
  const addTransfer = async (data: TransferFormData) => {
    try {
      // Note: Not setting global isLoading to avoid unmounting GroupViewScreen
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Create transfer entry
      // Note: keyVersion is always 1 in the simplified single-key model
      const entry: TransferEntry & { keyVersion: number } = {
        id: crypto.randomUUID(),
        groupId: group.id,
        type: 'transfer',
        version: 1,
        keyVersion: group.currentKeyVersion,
        // rootId is undefined for new entries (they are their own root)
        createdAt: Date.now(),
        createdBy: currentIdentity.publicKeyHash,
        status: 'active',
        amount: data.amount,
        currency: data.currency,
        date: data.date,
        from: data.from,
        to: data.to,
        notes: data.notes,
        // For multi-currency support
        defaultCurrencyAmount: data.defaultCurrencyAmount ?? data.amount,
      };

      // Get group key
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get version BEFORE adding entry
      const versionBefore = store.getVersion();

      // Add to Loro
      await store.createEntry(entry, groupKey, currentIdentity.publicKeyHash);

      // Get the Loro update to push to server
      const manager = syncManager();
      if (manager && autoSyncEnabled()) {
        try {
          // Export incremental update (changes since versionBefore)
          const updateBytes = store.exportFrom(versionBefore);

          // Push to server
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );

          // Update sync state
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync transfer, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI incrementally (faster than full regeneration)
      await refreshEntriesIncremental(group.id, entry, null, 'add');

      // Publish NTFY notification for other users
      publishNotification({
        groupId: group.id,
        groupName: group.name,
        groupKey,
        actorId: currentIdentity.publicKeyHash,
      }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add transfer');
      throw err;
    }
  };

  // Modify expense (creates new version)
  const modifyExpense = async (originalId: string, data: ExpenseFormData) => {
    try {
      // Note: Not setting global isLoading to avoid unmounting GroupViewScreen
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get original entry to preserve metadata and increment version
      const originalEntry = await store.getEntry(originalId, groupKey);
      if (!originalEntry) {
        throw new Error('Original entry not found');
      }

      // Create updated expense entry with new version
      const updatedEntry: ExpenseEntry & { keyVersion: number } = {
        id: crypto.randomUUID(),
        groupId: group.id,
        type: 'expense',
        version: originalEntry.version + 1,
        keyVersion: group.currentKeyVersion,
        previousVersionId: originalId,
        rootId: originalEntry.rootId ?? originalEntry.previousVersionId ?? originalEntry.id, // Preserve root chain
        createdAt: originalEntry.createdAt,
        createdBy: originalEntry.createdBy,
        modifiedAt: Date.now(),
        modifiedBy: currentIdentity.publicKeyHash,
        status: 'active',
        amount: data.amount,
        currency: data.currency,
        date: data.date,
        description: data.description,
        category: data.category,
        location: data.location,
        notes: data.notes,
        payers: data.payers,
        beneficiaries: data.beneficiaries,
        defaultCurrencyAmount: data.defaultCurrencyAmount ?? data.amount,
      };

      // Get version BEFORE modifying entry
      const versionBefore = store.getVersion();

      // Modify in Loro (creates new version with previousVersionId)
      await store.modifyEntry(originalId, updatedEntry, groupKey, currentIdentity.publicKeyHash);

      // Sync to server
      const manager = syncManager();
      if (manager && autoSyncEnabled()) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync modified expense:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI incrementally (faster than full regeneration)
      await refreshEntriesIncremental(group.id, updatedEntry, originalEntry, 'modify');

      // Publish NTFY notification for other users
      publishNotification({
        groupId: group.id,
        groupName: group.name,
        groupKey,
        actorId: currentIdentity.publicKeyHash,
      }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));

      // Clear editing state
      setEditingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to modify expense');
      throw err;
    }
  };

  // Modify transfer (creates new version)
  const modifyTransfer = async (originalId: string, data: TransferFormData) => {
    try {
      // Note: Not setting global isLoading to avoid unmounting GroupViewScreen
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get original entry to preserve metadata and increment version
      const originalEntry = await store.getEntry(originalId, groupKey);
      if (!originalEntry) {
        throw new Error('Original entry not found');
      }

      // Create updated transfer entry with new version
      const updatedEntry: TransferEntry & { keyVersion: number } = {
        id: crypto.randomUUID(),
        groupId: group.id,
        type: 'transfer',
        version: originalEntry.version + 1,
        keyVersion: group.currentKeyVersion,
        previousVersionId: originalId,
        rootId: originalEntry.rootId ?? originalEntry.previousVersionId ?? originalEntry.id, // Preserve root chain
        createdAt: originalEntry.createdAt,
        createdBy: originalEntry.createdBy,
        modifiedAt: Date.now(),
        modifiedBy: currentIdentity.publicKeyHash,
        status: 'active',
        amount: data.amount,
        currency: data.currency,
        date: data.date,
        from: data.from,
        to: data.to,
        notes: data.notes,
        defaultCurrencyAmount: data.defaultCurrencyAmount ?? data.amount,
      };

      // Get version BEFORE modifying entry
      const versionBefore = store.getVersion();

      // Modify in Loro (creates new version with previousVersionId)
      await store.modifyEntry(originalId, updatedEntry, groupKey, currentIdentity.publicKeyHash);

      // Sync to server
      const manager = syncManager();
      if (manager && autoSyncEnabled()) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync modified transfer:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI incrementally (faster than full regeneration)
      await refreshEntriesIncremental(group.id, updatedEntry, originalEntry, 'modify');

      // Publish NTFY notification for other users
      publishNotification({
        groupId: group.id,
        groupName: group.name,
        groupKey,
        actorId: currentIdentity.publicKeyHash,
      }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));

      // Clear editing state
      setEditingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to modify transfer');
      throw err;
    }
  };

  // Delete entry (soft delete - creates new version with status=deleted)
  const deleteEntry = async (entryId: string, reason?: string) => {
    try {
      // Note: Not setting global isLoading to avoid unmounting GroupViewScreen
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get original entry before deleting
      const originalEntry = await store.getEntry(entryId, groupKey);
      if (!originalEntry) {
        throw new Error('Entry not found');
      }

      // Get version BEFORE deleting entry
      const versionBefore = store.getVersion();

      // Delete in Loro (creates new version with status=deleted)
      const newVersionId = await store.deleteEntry(
        entryId,
        currentIdentity.publicKeyHash,
        groupKey,
        group.currentKeyVersion,
        reason
      );

      // Get the newly created deleted entry
      const deletedEntry = await store.getEntry(newVersionId, groupKey);
      if (!deletedEntry) {
        throw new Error('Failed to get deleted entry');
      }

      // Sync to server
      const manager = syncManager();
      if (manager && autoSyncEnabled()) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync deleted entry:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI incrementally (faster than full regeneration)
      await refreshEntriesIncremental(group.id, deletedEntry, originalEntry, 'delete');

      // Publish NTFY notification for other users
      publishNotification({
        groupId: group.id,
        groupName: group.name,
        groupKey,
        actorId: currentIdentity.publicKeyHash,
      }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
      throw err;
    }
  };

  // Undelete entry (restore deleted entry - creates new version with status=active)
  const undeleteEntry = async (entryId: string) => {
    try {
      // Note: Not setting global isLoading to avoid unmounting GroupViewScreen
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get deleted entry before undeleting
      const deletedEntry = await store.getEntry(entryId, groupKey);
      if (!deletedEntry) {
        throw new Error('Entry not found');
      }

      // Get version BEFORE undeleting
      const versionBefore = store.getVersion();

      // Undelete in Loro (creates new version with status=active)
      const newVersionId = await store.undeleteEntry(
        entryId,
        currentIdentity.publicKeyHash,
        groupKey,
        group.currentKeyVersion
      );

      // Get the newly created undeleted entry
      const undeletedEntry = await store.getEntry(newVersionId, groupKey);
      if (!undeletedEntry) {
        throw new Error('Failed to get undeleted entry');
      }

      // Sync to server
      const manager = syncManager();
      if (manager && autoSyncEnabled()) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync undeleted entry:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI incrementally (faster than full regeneration)
      await refreshEntriesIncremental(group.id, undeletedEntry, deletedEntry, 'undelete');

      // Publish NTFY notification for other users
      publishNotification({
        groupId: group.id,
        groupName: group.name,
        groupKey,
        actorId: currentIdentity.publicKeyHash,
      }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undelete entry');
      throw err;
    }
  };

  // Simplified: Create invitation with embedded group key
  const createInvitation = async (groupId: string) => {
    try {
      const group = activeGroup();
      if (!group || group.id !== groupId) {
        throw new Error('Group not found or not active');
      }

      // Get the group key from storage
      const groupKeyBase64 = await db.getGroupKey(groupId);
      if (!groupKeyBase64) {
        throw new Error('Group key not found');
      }

      // Generate invite link with embedded key (password is derived from key)
      const inviteLink = generateInviteLink(groupId, groupKeyBase64);

      return { inviteLink };
    } catch (err) {
      console.error('Failed to create invitation:', err);
      throw err;
    }
  };

  // Simplified: Join group with embedded key (no approval needed)
  const joinGroupWithKey = async (
    groupId: string,
    groupKeyBase64: string,
    memberName: string,
    existingMemberId?: string
  ) => {
    try {
      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found');
      }

      // Authenticate as group account (password derived from key)
      await pbClient.authenticateAsGroup(groupId, groupKeyBase64);

      // Fetch all updates from server to build the Loro state
      const updates = await pbClient.fetchAllUpdates(groupId);

      // Create a new Loro store and apply all updates
      const newLoroStore = new LoroEntryStore(currentIdentity.publicKeyHash);

      for (const update of updates) {
        const updateBytes = PocketBaseClient.decodeUpdateData(update.updateData);
        newLoroStore.applyUpdate(updateBytes);
      }

      // Check if we already have this group AND current identity is a member
      const canJoin = checkCanJoinGroup(
        groupId,
        groups(),
        newLoroStore,
        currentIdentity.publicKeyHash
      );

      if (!canJoin) {
        throw new Error('You are already a member of this group');
      }

      // Get existing members using event-based system
      const existingMembers = getAllMembersForCache(newLoroStore);

      // Get group metadata from server (or create default)
      let groupRecord;
      try {
        groupRecord = await pbClient.getGroup(groupId);
      } catch {
        console.warn('Could not fetch group metadata, using defaults');
      }

      // Create the group object
      const group: Group = {
        id: groupId,
        name: groupRecord?.name || 'Group',
        defaultCurrency: 'USD', // Default, will be synced from CRDT
        createdAt: groupRecord?.createdAt || Date.now(),
        createdBy: groupRecord?.createdBy || currentIdentity.publicKeyHash,
        currentKeyVersion: 1, // Simplified: always version 1
        settings: DEFAULT_GROUP_SETTINGS,
        activeMembers: existingMembers,
      };

      // Save group and key locally (password is derived from key, no need to store)
      await db.saveGroup(group);
      await db.saveGroupKey(groupId, groupKeyBase64);

      // Add member to Loro (with replacement if claiming existing member)
      // Uses the new event-based system for proper validation
      const versionBefore = newLoroStore.getVersion();

      if (existingMemberId) {
        // Claiming an existing member identity
        const existingMember = existingMembers.find((m) => m.id === existingMemberId);
        if (!existingMember) {
          throw new Error('Selected member not found');
        }

        // Add the new real member using event-based system
        newLoroStore.createMember(
          currentIdentity.publicKeyHash,
          memberName,
          currentIdentity.publicKeyHash,
          { publicKey: currentIdentity.publicKey, isVirtual: false }
        );

        // Replace the existing member with the new member using event-based system
        const replaceResult = newLoroStore.replaceMember(
          existingMemberId,
          currentIdentity.publicKeyHash,
          currentIdentity.publicKeyHash
        );

        if (LoroEntryStore.isValidationError(replaceResult)) {
          console.warn('[AppContext] Could not replace member:', replaceResult.reason);
          // Continue anyway - the new member is already created
        }
      } else {
        // New member (not claiming existing identity)
        newLoroStore.createMember(
          currentIdentity.publicKeyHash,
          memberName,
          currentIdentity.publicKeyHash,
          { publicKey: currentIdentity.publicKey, isVirtual: false }
        );
      }

      // Save the Loro snapshot
      const snapshot = newLoroStore.exportSnapshot();
      const version = newLoroStore.getVersion();
      await db.saveLoroSnapshot(groupId, snapshot, version);
      newLoroStore.markAsSaved();

      // Push the member update to server
      const updateBytes = newLoroStore.exportFrom(versionBefore);
      if (updateBytes.length > 0) {
        await pbClient.pushUpdate({
          groupId,
          timestamp: Date.now(),
          actorId: currentIdentity.publicKeyHash,
          updateData: PocketBaseClient.encodeUpdateData(updateBytes),
          version: PocketBaseClient.serializeVersion(version),
        });

        // Publish NTFY notification for other users
        const groupName = groupRecord?.name || 'Group';
        const groupKey = await importSymmetricKey(groupKeyBase64);
        publishNotification({
          groupId,
          groupName,
          groupKey,
          actorId: currentIdentity.publicKeyHash,
        }).catch((err) => console.warn('[AppContext] Failed to publish NTFY notification:', err));
      }

      // Update the group with filtered members using event-based system or legacy fallback
      const finalMembers = getAllMembersForCache(newLoroStore);
      const updatedGroup = { ...group, activeMembers: finalMembers };
      await db.saveGroup(updatedGroup);

      // Update groups list
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);

      // Select the new group
      await selectGroup(groupId);
    } catch (err) {
      console.error('[AppContext] Failed to join group:', err);
      throw err;
    }
  };

  // Manual sync - force sync now
  const manualSync = async () => {
    const manager = syncManager();
    const group = activeGroup();
    const currentIdentity = identity();

    if (!manager || !group || !currentIdentity) {
      console.warn('[AppContext] Cannot sync: missing manager, group, or identity');
      return;
    }

    try {
      setIsLoading(true);

      // Perform incremental sync
      await manager.incrementalSync(group.id, currentIdentity.publicKeyHash);

      // Refresh entries
      await refreshEntries(group.id, group.currentKeyVersion);

      // Update sync state
      setSyncState(manager.getState());
    } catch (err) {
      console.error('[AppContext] Manual sync failed:', err);
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Toggle auto-sync on/off
  const toggleAutoSync = () => {
    setAutoSyncEnabled(!autoSyncEnabled());
  };

  const clearError = () => setError(null);

  // Export groups (all groups if groupIds not specified)
  const exportGroups = async (groupIds?: string[]): Promise<string> => {
    try {
      // Don't set isLoading - let the calling component manage loading state
      setError(null);

      // Get all groups or specified groups
      const allGroups = await db.getAllGroups();
      const groupsToExport = groupIds
        ? allGroups.filter((g) => groupIds.includes(g.id))
        : allGroups;

      if (groupsToExport.length === 0) {
        throw new Error('No groups to export');
      }

      const groupExports: GroupExport[] = [];

      for (const group of groupsToExport) {
        // Get the group key
        const key = await db.getGroupKey(group.id);
        if (!key) {
          console.warn(`No key found for group ${group.id}, skipping`);
          continue;
        }

        // Get Loro snapshot
        const snapshot = await db.getLoroSnapshot(group.id);
        if (!snapshot) {
          console.warn(`No snapshot found for group ${group.id}, skipping`);
          continue;
        }

        groupExports.push({
          group,
          key,
          loroSnapshot: snapshot,
        });
      }

      const exportData: ExportData = {
        version: '1.0.0',
        exportedAt: Date.now(),
        groups: groupExports,
      };

      // Serialize to JSON (convert Uint8Arrays and Maps to plain objects)
      const serialized = JSON.stringify(
        exportData,
        (_key, value) => {
          if (value instanceof Uint8Array) {
            return { __type: 'Uint8Array', data: Array.from(value) };
          }
          if (value instanceof Map) {
            return { __type: 'Map', entries: Array.from(value.entries()) };
          }
          return value;
        },
        2
      );

      return serialized;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export groups');
      throw err;
    }
  };

  // Analyze imported data and compare with local groups
  const importGroups = async (exportedData: string): Promise<ImportAnalysis> => {
    try {
      // Don't set isLoading here - it causes the component to unmount!
      // The calling component should manage its own loading state
      setError(null);

      // Deserialize JSON (restore Uint8Arrays and Maps)
      let parsed: any;
      try {
        parsed = JSON.parse(exportedData, (_key, value) => {
          if (value && value.__type === 'Uint8Array') {
            return new Uint8Array(value.data);
          }
          if (value && value.__type === 'Map') {
            return new Map(value.entries);
          }
          return value;
        });
      } catch (parseError) {
        console.error('[importGroups] JSON parse failed:', parseError);
        throw new Error(
          'Failed to parse import file: ' +
            (parseError instanceof Error ? parseError.message : 'Invalid JSON')
        );
      }

      const importData: ExportData = parsed;

      if (!importData.version || !importData.groups) {
        console.error('[importGroups] Invalid export data:', importData);
        throw new Error('Invalid export data format: missing version or groups');
      }

      // Analyze each group
      const analysis: ImportAnalysis['groups'] = [];

      for (const groupExport of importData.groups) {
        const existingGroup = await db.getGroup(groupExport.group.id);

        if (!existingGroup) {
          // New group
          analysis.push({
            group: groupExport.group,
            exists: false,
            relationship: 'new',
          });
        } else {
          // Group exists - compare Loro versions
          const existingSnapshot = await db.getLoroSnapshot(groupExport.group.id);

          if (!existingSnapshot) {
            // Local group has no snapshot - import is superset
            analysis.push({
              group: groupExport.group,
              exists: true,
              relationship: 'import_subset',
            });
          } else {
            // Compare snapshots using Loro
            const currentIdentity = identity();
            if (!currentIdentity) {
              throw new Error('No identity found');
            }

            // Test 1: Does import have new data for us?
            // Load local snapshot, compare snapshot sizes after importing remote
            const testStoreLocal = new LoroEntryStore(currentIdentity.publicKeyHash);
            testStoreLocal.importSnapshot(existingSnapshot);
            const localSnapshotBefore = testStoreLocal.exportSnapshot();

            testStoreLocal.importSnapshot(groupExport.loroSnapshot);
            const localSnapshotAfter = testStoreLocal.exportSnapshot();

            const importHasNewData =
              localSnapshotBefore.byteLength !== localSnapshotAfter.byteLength;

            // Test 2: Does local have new data not in import?
            // Load import snapshot, compare snapshot sizes after importing local
            const testStoreImport = new LoroEntryStore(currentIdentity.publicKeyHash);
            testStoreImport.importSnapshot(groupExport.loroSnapshot);
            const importSnapshotBefore = testStoreImport.exportSnapshot();

            testStoreImport.importSnapshot(existingSnapshot);
            const importSnapshotAfter = testStoreImport.exportSnapshot();

            const localHasNewData =
              importSnapshotBefore.byteLength !== importSnapshotAfter.byteLength;

            let relationship: 'local_subset' | 'import_subset' | 'diverged';

            if (!importHasNewData && !localHasNewData) {
              // Both snapshots are identical
              relationship = 'import_subset';
            } else if (importHasNewData && !localHasNewData) {
              // Import has new data, local doesn't - local is subset of import
              relationship = 'local_subset';
            } else if (!importHasNewData && localHasNewData) {
              // Local has new data, import doesn't - import is subset of local
              relationship = 'import_subset';
            } else {
              // Both have unique data - diverged
              relationship = 'diverged';
            }

            analysis.push({
              group: groupExport.group,
              exists: true,
              relationship,
              localVersion: `${localSnapshotBefore.byteLength} bytes`,
              importVersion: `${groupExport.loroSnapshot.byteLength} bytes`,
            });
          }
        }
      }

      const result = {
        groups: analysis,
        exportData: importData,
      };

      return result;
    } catch (err) {
      console.error('[importGroups] Error during analysis:', err);
      setError(err instanceof Error ? err.message : 'Failed to analyze import');
      throw err;
    }
  };

  // Confirm and execute import
  const confirmImport = async (importData: ExportData, mergeExisting: boolean) => {
    try {
      // Don't set isLoading - let the calling component manage loading state
      setError(null);

      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found');
      }

      for (const groupExport of importData.groups) {
        const existingGroup = await db.getGroup(groupExport.group.id);

        if (!existingGroup) {
          // New group - import directly
          await db.saveGroup(groupExport.group);

          // Save the group key
          await db.saveGroupKey(groupExport.group.id, groupExport.key);

          // Save Loro snapshot (get version from imported snapshot)
          const tempStore = new LoroEntryStore(currentIdentity.publicKeyHash);
          tempStore.importSnapshot(groupExport.loroSnapshot);
          const importVersion = tempStore.getVersion();
          await db.saveLoroSnapshot(groupExport.group.id, groupExport.loroSnapshot, importVersion);
        } else if (mergeExisting) {
          // Merge with existing group
          const existingSnapshot = await db.getLoroSnapshot(groupExport.group.id);

          if (existingSnapshot) {
            // Merge Loro snapshots
            const mergedStore = new LoroEntryStore(currentIdentity.publicKeyHash);
            mergedStore.importSnapshot(existingSnapshot);
            mergedStore.importSnapshot(groupExport.loroSnapshot);

            const mergedSnapshot = mergedStore.exportSnapshot();
            const mergedVersion = mergedStore.getVersion();
            await db.saveLoroSnapshot(groupExport.group.id, mergedSnapshot, mergedVersion);

            // Update members from merged Loro using event-based system
            const filteredMergedMembers = getAllMembersForCache(mergedStore);
            const updatedGroup = { ...existingGroup, activeMembers: filteredMergedMembers };
            await db.saveGroup(updatedGroup);
          } else {
            // No existing snapshot - just import (get version from imported snapshot)
            const tempStore2 = new LoroEntryStore(currentIdentity.publicKeyHash);
            tempStore2.importSnapshot(groupExport.loroSnapshot);
            const importVersion2 = tempStore2.getVersion();
            await db.saveLoroSnapshot(
              groupExport.group.id,
              groupExport.loroSnapshot,
              importVersion2
            );
          }

          // Import key if missing
          const existingKey = await db.getGroupKey(groupExport.group.id);
          if (!existingKey) {
            await db.saveGroupKey(groupExport.group.id, groupExport.key);
          }
        }
      }

      // Refresh groups list
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import groups');
      throw err;
    }
  };

  // Delete a group
  const deleteGroup = async (groupId: string) => {
    try {
      // Don't set isLoading - let the calling component manage loading state
      setError(null);

      // If this is the active group, deselect it first
      if (activeGroup()?.id === groupId) {
        await deselectGroup();
      }

      // Delete from database
      await db.deleteGroup(groupId);

      // Refresh groups list
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete group');
      throw err;
    }
  };

  // Update settlement preferences for a user (uses Loro for sync)
  const updateSettlementPreferences = async (userId: string, preferredRecipients: string[]) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();
      const manager = syncManager();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get version BEFORE updating preference
      const versionBefore = store.getVersion();

      // Update preference in Loro
      store.setSettlementPreference(userId, preferredRecipients);

      // IMPORTANT: Trigger reactive update IMMEDIATELY after Loro modification
      // Increment version counter to force settlement plan recalculation
      setPreferencesVersion((v) => v + 1);
      setLoroStore(store);

      // Sync to server (async, happens in background)
      if (manager && autoSyncEnabled()) {
        try {
          // Export incremental update (changes since versionBefore)
          const updateBytes = store.exportFrom(versionBefore);

          // Push to server
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );

          // Update sync state
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync preference, queued for later:', syncError);
        }
      }

      // Save snapshot to IndexedDB (async, happens in background)
      await snapshotManager().saveIncremental(group.id, store);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update preferences');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Update group metadata (subtitle, description, links)
  const updateGroupMetadata = async (metadata: {
    subtitle?: string;
    description?: string;
    links?: GroupLink[];
  }) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();
      const manager = syncManager();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key for encryption
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get version BEFORE updating metadata
      const versionBefore = store.getVersion();

      // Update metadata in Loro (encrypted)
      await store.updateGroupMetadata(group.id, metadata, currentIdentity.publicKeyHash, groupKey);

      // Refresh the groupMetadata signal with the new decrypted state
      const updatedMetadata = await store.getGroupMetadata(group.id, groupKey);
      setGroupMetadata(updatedMetadata);

      // Trigger reactive update
      setLoroStore(store);

      // Sync to server
      if (manager && autoSyncEnabled()) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync group metadata, queued for later:', syncError);
        }
      }

      // Save snapshot to IndexedDB
      await snapshotManager().saveIncremental(group.id, store);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update group metadata');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Update member metadata (phone, payment info, etc.)
  const updateMemberMetadata = async (
    memberId: string,
    metadata: {
      phone?: string;
      payment?: MemberPaymentInfo;
      info?: string;
    }
  ) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();
      const manager = syncManager();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key for encryption
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        throw new Error('Group key not found');
      }
      const groupKey = await importSymmetricKey(keyString);

      // Get version BEFORE updating metadata
      const versionBefore = store.getVersion();

      // Update metadata in Loro (encrypted)
      await store.updateMemberMetadata(memberId, metadata, currentIdentity.publicKeyHash, groupKey);

      // Trigger reactive update
      setLoroStore(store);

      // Sync to server
      if (manager && autoSyncEnabled()) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
          setSyncState(manager.getState());
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync member metadata, queued for later:', syncError);
        }
      }

      // Save snapshot to IndexedDB
      await snapshotManager().saveIncremental(group.id, store);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member metadata');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Get decrypted metadata for a specific member
   * Optimized: only decrypts the latest metadata event for this member
   * Returns null if member not found or metadata cannot be decrypted
   */
  const getMemberMetadata = async (
    memberId: string
  ): Promise<{ phone?: string; payment?: MemberPaymentInfo; info?: string } | null> => {
    const group = activeGroup();
    const store = loroStore();

    if (!group || !store) {
      return null;
    }

    try {
      const keyString = await db.getGroupKey(group.id);
      if (!keyString) {
        return null;
      }
      const groupKey = await importSymmetricKey(keyString);

      // Use optimized method that only decrypts the latest event
      return await store.getMemberMetadata(memberId, groupKey);
    } catch (err) {
      console.warn('[AppContext] Failed to get member metadata:', err);
      return null;
    }
  };

  /**
   * Add a virtual member to the active group
   * Uses the new event-based member system
   */
  const addVirtualMember = async (name: string): Promise<void> => {
    const group = activeGroup();
    const store = loroStore();
    const manager = syncManager();
    const currentIdentity = identity();

    if (!group || !store || !currentIdentity) {
      throw new Error('No active group or store');
    }

    try {
      setIsLoading(true);

      // Check if a member with this name already exists
      const activeStates = store.getActiveMemberStates();
      const normalizedName = name.trim().toLowerCase();
      const nameExists = activeStates.some(
        (state) => state.name.trim().toLowerCase() === normalizedName
      );
      if (nameExists) {
        throw new Error('A member with this name already exists');
      }

      // Generate unique ID for virtual member
      const virtualMemberId = crypto.randomUUID();

      // Add to Loro store using event-based system
      const versionBefore = store.getVersion();
      store.createMember(virtualMemberId, name, currentIdentity.publicKeyHash, {
        isVirtual: true,
      });

      // Sync to server if online
      if (manager) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(group.id, currentIdentity.publicKeyHash, updateBytes);
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync member addition, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh members using event-based system or legacy fallback
      const updatedMembers = getAllMembersForCache(store);
      const updatedGroup = { ...group, activeMembers: updatedMembers };
      setActiveGroup(updatedGroup);
      await db.saveGroup(updatedGroup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Helper function to get all members (active + retired) from store for caching
   * Uses the event-based system exclusively
   */
  const getAllMembersForCache = (store: LoroEntryStore): Member[] => {
    // Get active members
    const activeStates = store.getActiveMemberStates();
    const activeMembersList: Member[] = activeStates.map((state) => ({
      id: state.id,
      name: state.name,
      publicKey: state.publicKey,
      joinedAt: state.createdAt,
      leftAt: undefined,
      status: 'active' as const,
      isVirtual: state.isVirtual,
      addedBy: state.createdBy,
    }));

    // Get retired members
    const retiredStates = store.getRetiredMemberStates();
    const retiredMembersList: Member[] = retiredStates.map((state) => ({
      id: state.id,
      name: state.name,
      publicKey: state.publicKey,
      joinedAt: state.createdAt,
      leftAt: state.retiredAt,
      status: 'departed' as const,
      isVirtual: state.isVirtual,
      addedBy: state.createdBy,
    }));

    return [...activeMembersList, ...retiredMembersList];
  };

  /**
   * Rename a member in the active group
   * Uses the new event-based member system with validation
   */
  const renameMember = async (memberId: string, newName: string): Promise<void> => {
    const group = activeGroup();
    const store = loroStore();
    const manager = syncManager();
    const currentIdentity = identity();

    if (!group || !store || !currentIdentity) {
      throw new Error('No active group or store');
    }

    try {
      setIsLoading(true);

      // Rename using event-based system
      const versionBefore = store.getVersion();
      const result = store.renameMemberViaEvent(memberId, newName, currentIdentity.publicKeyHash);

      // Check if the operation was invalid
      if (LoroEntryStore.isValidationError(result)) {
        throw new Error(result.reason || 'Cannot rename member');
      }

      // Sync to server if online
      if (manager) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(group.id, currentIdentity.publicKeyHash, updateBytes);
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync member rename, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh members using event-based system or legacy fallback
      const updatedMembers = getAllMembersForCache(store);
      const updatedGroup = { ...group, activeMembers: updatedMembers };
      setActiveGroup(updatedGroup);
      await db.saveGroup(updatedGroup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename member');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Remove a member from the active group (retire them)
   * Uses the new event-based member system with validation
   */
  const removeMember = async (memberId: string): Promise<void> => {
    const group = activeGroup();
    const store = loroStore();
    const manager = syncManager();
    const currentIdentity = identity();

    if (!group || !store || !currentIdentity) {
      throw new Error('No active group or store');
    }

    try {
      setIsLoading(true);

      // Retire member using event-based system
      const versionBefore = store.getVersion();
      const result = store.retireMember(memberId, currentIdentity.publicKeyHash);

      // Check if the operation was invalid
      if (LoroEntryStore.isValidationError(result)) {
        throw new Error(result.reason || 'Cannot remove member');
      }

      // Sync to server if online
      if (manager) {
        try {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(group.id, currentIdentity.publicKeyHash, updateBytes);
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync member removal, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh members using event-based system or legacy fallback
      const updatedMembers = getAllMembersForCache(store);
      const updatedGroup = { ...group, activeMembers: updatedMembers };
      setActiveGroup(updatedGroup);
      await db.saveGroup(updatedGroup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Get the personal balance for a specific group without selecting it
   * Returns the user's net balance in the group, or null if not found
   */
  const getGroupBalance = async (groupId: string): Promise<Balance | null> => {
    try {
      const currentIdentity = identity();
      if (!currentIdentity) {
        return null;
      }

      // Get group from database
      const group = await db.getGroup(groupId);
      if (!group) {
        return null;
      }

      // Get group key
      const keyString = await db.getGroupKey(groupId);
      if (!keyString) {
        return null;
      }
      const groupKey = await importSymmetricKey(keyString);

      // Load Loro snapshot
      const snapshot = await db.getLoroSnapshot(groupId);
      const tempStore = new LoroEntryStore(currentIdentity.publicKeyHash);

      if (snapshot) {
        tempStore.importSnapshot(snapshot);
      }

      // Get active entries and calculate balances with event-based alias resolution
      const activeEntries = await tempStore.getActiveEntries(groupId, groupKey);
      const memberEvents = tempStore.getMemberEvents();
      const calculatedBalances = calculateBalances(activeEntries, memberEvents);

      // Find user's member ID in this group (considering aliases)
      // The balance calculator uses canonical (existing) member IDs
      const userMemberId = currentIdentity.publicKeyHash;

      // Resolve to canonical ID (if user claimed a virtual member)
      const canonicalUserId = tempStore.resolveCanonicalMemberId(userMemberId);

      return calculatedBalances.get(canonicalUserId) || null;
    } catch (err) {
      console.error('Failed to get group balance:', err);
      return null;
    }
  };

  const value: AppContextValue = {
    db,
    loroStore,
    syncManager,
    identity,
    initializeIdentity,
    groups,
    activeGroup,
    createGroup,
    selectGroup,
    deselectGroup,
    getActiveGroupKey,
    members,
    addVirtualMember,
    renameMember,
    removeMember,
    entries,
    conflictingEntryIds,
    showDeleted,
    setShowDeleted,
    entryFilter,
    setEntryFilter,
    addExpense,
    addTransfer,
    modifyExpense,
    modifyTransfer,
    deleteEntry,
    undeleteEntry,
    editingEntry,
    setEditingEntry,
    balances,
    settlementPlan,
    getGroupBalance,
    activities,
    activityFilter,
    setActivityFilter,
    createInvitation,
    joinGroupWithKey,
    syncState,
    manualSync,
    toggleAutoSync,
    updateSettlementPreferences,
    groupMetadata,
    getMemberMetadata,
    updateGroupMetadata,
    updateMemberMetadata,
    preferencesVersion,
    exportGroups,
    importGroups,
    confirmImport,
    deleteGroup,
    isLoading,
    error,
    clearError,
  };

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
};

// Hook to use context
export const useAppContext = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider');
  }
  return context;
};
