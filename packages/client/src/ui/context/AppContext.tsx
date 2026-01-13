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
import {
  generateAllActivities,
  filterActivities,
} from '../../domain/calculations/activity-generator';
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
  MemberAlias,
} from '@partage/shared';
import { DEFAULT_GROUP_SETTINGS } from '@partage/shared';
import { generateInviteLink } from '../../domain/invitations/invite-manager';

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

  // User identity
  identity: Accessor<SerializedKeypair | null>;
  initializeIdentity: () => Promise<void>;

  // Groups
  groups: Accessor<Group[]>;
  activeGroup: Accessor<Group | null>;
  createGroup: (
    name: string,
    currency: string,
    members: Member[],
    myUserName?: string
  ) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
  deselectGroup: () => void;

  // Members for active group
  members: Accessor<Member[]>;
  addVirtualMember: (name: string) => Promise<void>;
  renameMember: (memberId: string, newName: string) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;

  // Entries (derived from Loro)
  entries: Accessor<Entry[]>;
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
  createInvitation: (groupId: string, groupName: string) => Promise<{ inviteLink: string }>;
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

// Create context
const AppContext = createContext<AppContextValue>();

// Provider component
export const AppProvider: Component<{ children: JSX.Element }> = (props) => {
  console.log('[AppProvider] Component rendering...');
  const db = getDB();
  console.log('[AppProvider] Database instance created');

  // Snapshot manager for incremental updates
  const [snapshotManager] = createSignal(new SnapshotManager(db, 50)); // Consolidate every 50 updates

  // Core state
  const [identity, setIdentity] = createSignal<SerializedKeypair | null>(null);
  const [groups, setGroups] = createSignal<Group[]>([]);
  const [activeGroup, setActiveGroup] = createSignal<Group | null>(null);
  const [loroStore, setLoroStore] = createSignal<LoroEntryStore | null>(null);
  const [syncManager, setSyncManager] = createSignal<SyncManager | null>(null);

  // Derived state
  const [entries, setEntries] = createSignal<Entry[]>([]);
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

  // Members for active group (all members: real + virtual, excluding replaced virtual members)
  const members = createMemo(() => {
    const group = activeGroup();
    if (!group) {
      console.log('[AppContext] members() called but no active group');
      return [];
    }
    const store = loroStore();
    if (!store) {
      const membersList = group.members || [];
      console.log('[AppContext] members() returning:', membersList);
      return membersList;
    }

    // Get member aliases to filter out replaced virtual members
    const aliases = store.getMemberAliases();
    const replacedMemberIds = new Set(aliases.map(a => a.existingMemberId));

    // Filter out replaced virtual members (those claimed by new members)
    const membersList = (group.members || []).filter(m => {
      // Keep all real members (non-virtual)
      if (!m.isVirtual) return true;
      // Keep virtual members that haven't been replaced
      return !replacedMemberIds.has(m.id);
    });

    console.log('[AppContext] members() returning:', membersList);
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
    console.log('[AppContext] onMount - initializing app...');
    try {
      setIsLoading(true);

      // Open database
      await db.open();
      console.log('[AppContext] Database opened');

      // Load user identity
      const storedIdentity = await db.getUserKeypair();
      setIdentity(storedIdentity?.keypair || null);

      // Load all groups
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);

      // Check server connectivity
      const isServerReachable = await pbClient.healthCheck();
      console.log('[AppContext] Server reachable:', isServerReachable);
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
          await snapshotManager().consolidateOnIdle(activeGroup()!.id, store).catch((err) => {
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
  const createGroup = async (
    name: string,
    currency: string,
    virtualMembers: Member[],
    myUserName: string = 'You'
  ) => {
    console.log('[AppContext] createGroup called with:', {
      name,
      currency,
      virtualMembers,
      myUserName,
    });
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found. Please initialize identity first.');
      }
      console.log('[AppContext] Current identity:', currentIdentity.publicKeyHash);

      // Create group on server first to get server-generated ID
      let groupId: string;
      const createdAt = Date.now();

      if (navigator.onLine) {
        try {
          console.log('[AppContext] Creating group on server...');
          const serverGroup = await pbClient.createGroup({
            name,
            createdAt,
            createdBy: currentIdentity.publicKeyHash,
            lastActivityAt: createdAt,
            memberCount: virtualMembers.length + 1,
          });
          groupId = serverGroup.id;
          console.log('[AppContext] Group created on server with ID:', groupId);
        } catch (error) {
          console.error('[AppContext] Failed to create group on server:', error);
          throw new Error('Failed to create group on server. Please check your connection.');
        }
      } else {
        // Offline: use UUID (will need special handling for sync later)
        groupId = crypto.randomUUID();
        console.log('[AppContext] Offline: using local UUID:', groupId);
      }

      // Generate group key
      const groupKey = await generateSymmetricKey();
      const exportedKey = await exportSymmetricKey(groupKey);

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
        members: [
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

      // Initialize Loro store and add initial members
      const newLoroStore = new LoroEntryStore(currentIdentity.publicKeyHash);

      // Add creator as first member
      newLoroStore.addMember({
        id: currentIdentity.publicKeyHash,
        name: myUserName,
        publicKey: currentIdentity.publicKey,
        joinedAt: Date.now(),
        status: 'active',
        isVirtual: false,
      });

      // Add virtual members to Loro
      for (const member of virtualMembers) {
        newLoroStore.addMember(member);
      }

      // Save to database
      console.log('[AppContext] Saving group locally with ID:', groupId);
      console.log('[AppContext] Group members:', group.members);
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
          console.log('[AppContext] Pushing initial group state to server...');
          const tempManager = new SyncManager({
            loroStore: newLoroStore,
            storage: db,
            apiClient: pbClient,
            enableAutoSync: false, // Don't auto-sync yet
          });

          // Export the initial state as a snapshot (Loro handles this correctly on import)
          const updateBytes = newLoroStore.exportSnapshot();
          await tempManager.pushUpdate(groupId, currentIdentity.publicKeyHash, updateBytes);
          console.log(
            '[AppContext] Initial state pushed to server, bytes:',
            updateBytes.byteLength
          );

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

      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found');
      }

      // Get group from database
      const group = await db.getGroup(groupId);
      if (!group) {
        throw new Error('Group not found');
      }

      console.log('[AppContext] Loaded group from DB:', group);
      console.log('[AppContext] Group members:', group.members);

      // Load Loro snapshot + incremental updates (and consolidate)
      const store = new LoroEntryStore(currentIdentity.publicKeyHash);
      await snapshotManager().load(groupId, store);

      // Sync members from Loro to group object (filter out replaced virtual members)
      const allMembers = store.getMembers();
      const aliases = store.getMemberAliases();
      const replacedMemberIds = new Set(aliases.map(a => a.existingMemberId));

      // Filter out replaced virtual members
      const activeMembers = allMembers.filter(m => {
        if (!m.isVirtual) return true; // Keep all real members
        return !replacedMemberIds.has(m.id); // Keep virtual members that haven't been replaced
      });

      const updatedGroup = { ...group, members: activeMembers };
      if (activeMembers.length > 0) {
        await db.saveGroup(updatedGroup);
      }

      setLoroStore(store);
      setActiveGroup(updatedGroup);
      console.log('[AppContext] Active group set, members:', activeGroup()?.members);

      // Initialize sync manager
      const manager = new SyncManager({
        loroStore: store,
        storage: db,
        apiClient: pbClient,
        enableAutoSync: autoSyncEnabled(),
        onUpdate: async (updatedGroupId) => {
          console.log('[AppContext] Received update for group:', updatedGroupId);
          // Refresh entries and members when updates are received
          if (updatedGroupId === groupId) {
            await refreshEntries(groupId, group.currentKeyVersion);

            // Update members from Loro (filter out replaced virtual members)
            const allUpdatedMembers = store.getMembers();
            const updatedAliases = store.getMemberAliases();
            const updatedReplacedMemberIds = new Set(updatedAliases.map(a => a.existingMemberId));

            const filteredMembers = allUpdatedMembers.filter(m => {
              if (!m.isVirtual) return true;
              return !updatedReplacedMemberIds.has(m.id);
            });

            const refreshedGroup = { ...group, members: filteredMembers };
            await db.saveGroup(refreshedGroup);
            setActiveGroup(refreshedGroup);

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

      // Perform initial sync if online
      if (navigator.onLine && autoSyncEnabled()) {
        try {
          console.log('[AppContext] Starting initial sync...');
          await manager.initialSync(groupId, currentIdentity.publicKeyHash);

          // Subscribe to real-time updates
          await manager.subscribeToGroup(groupId, currentIdentity.publicKeyHash);

          // Refresh entries after sync
          await refreshEntries(groupId, group.currentKeyVersion);

          // Sync members from Loro after sync (in case new members were added)
          // Filter out replaced virtual members
          const syncedMembers = store.getMembers();
          const syncedAliases = store.getMemberAliases();
          const syncedReplacedMemberIds = new Set(syncedAliases.map(a => a.existingMemberId));

          const filteredSyncedMembers = syncedMembers.filter(m => {
            if (!m.isVirtual) return true; // Keep all real members
            return !syncedReplacedMemberIds.has(m.id); // Keep virtual members that haven't been replaced
          });

          const syncedGroup = { ...updatedGroup, members: filteredSyncedMembers };
          if (filteredSyncedMembers.length > 0) {
            await db.saveGroup(syncedGroup);
            setActiveGroup(syncedGroup);
          }

          // Update sync state
          setSyncState(manager.getState());

          console.log('[AppContext] Initial sync completed');
        } catch (syncError) {
          console.warn('[AppContext] Sync failed, continuing in offline mode:', syncError);
          setSyncState(manager.getState());
        }
      } else {
        console.log('[AppContext] Offline mode - skipping sync');
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

    setActiveGroup(null);
    setLoroStore(null);
    setEntries([]);
    setBalances(new Map());
    setSyncState({
      status: 'idle',
      lastSyncTimestamp: null,
      lastError: null,
      isOnline: navigator.onLine,
      activeSubscriptions: 0,
    });
  };

  // Refresh entries from Loro store
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

      // Get entries based on showDeleted toggle
      let allEntries: Entry[];
      if (showDeleted()) {
        // Get current versions of all entries including deleted (excludes superseded)
        allEntries = await store.getCurrentEntries(groupId, groupKey);
      } else {
        // Get only active entries (excludes deleted and superseded)
        allEntries = await store.getActiveEntries(groupId, groupKey);
      }

      setEntries(allEntries);

      // Calculate balances (always use only active entries for balance calculation)
      const activeEntries = await store.getActiveEntries(groupId, groupKey);
      const memberAliases = store.getMemberAliases();
      const calculatedBalances = calculateBalances(activeEntries, memberAliases);
      setBalances(calculatedBalances);

      // Generate activities from ALL entries (including all versions for audit trail)
      const allEntriesForActivities = await store.getAllEntries(groupId, groupKey);
      const currentMembers = members();
      const generatedActivities = generateAllActivities(
        allEntriesForActivities,
        currentMembers,
        groupId
      );
      setAllActivities(generatedActivities);
    } catch (err) {
      console.error('Failed to refresh entries:', err);
      setError(err instanceof Error ? err.message : 'Failed to load entries');
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

          console.log('[AppContext] Expense synced to server');
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync expense, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
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

          console.log('[AppContext] Transfer synced to server');
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync transfer, queued for later:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
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
          console.log('[AppContext] Modified expense synced to server');
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync modified expense:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);

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
          console.log('[AppContext] Modified transfer synced to server');
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync modified transfer:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);

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

      console.log(
        `[AppContext] Deleted entry ${entryId}, created new version ${newVersionId} with status=deleted`
      );

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
          console.log('[AppContext] Deleted entry synced to server');
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync deleted entry:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
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

      // Get version BEFORE undeleting
      const versionBefore = store.getVersion();

      // Undelete in Loro (creates new version with status=active)
      const newVersionId = await store.undeleteEntry(
        entryId,
        currentIdentity.publicKeyHash,
        groupKey,
        group.currentKeyVersion
      );

      console.log(
        `[AppContext] Undeleted entry ${entryId}, created new version ${newVersionId} with status=active`
      );

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
          console.log('[AppContext] Undeleted entry synced to server');
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync undeleted entry:', syncError);
        }
      }

      // Save snapshot
      await snapshotManager().saveIncremental(group.id, store);

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undelete entry');
      throw err;
    }
  };

  // Simplified: Create invitation with embedded group key
  const createInvitation = async (groupId: string, groupName: string) => {
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

      // Generate invite link with embedded key
      const inviteLink = generateInviteLink(groupId, groupKeyBase64, groupName);

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

      // Check if we already have this group
      const existingGroup = groups().find(g => g.id === groupId);
      if (existingGroup) {
        throw new Error('You are already a member of this group');
      }

      // Fetch all updates from server to build the Loro state
      const updates = await pbClient.fetchAllUpdates(groupId);

      // Create a new Loro store and apply all updates
      const newLoroStore = new LoroEntryStore(currentIdentity.publicKeyHash);
      
      for (const update of updates) {
        const updateBytes = PocketBaseClient.decodeUpdateData(update.updateData);
        newLoroStore.applyUpdate(updateBytes);
      }

      // Get existing members
      const existingMembers = newLoroStore.getMembers();

      // Get group metadata from server (or create default)
      let groupRecord;
      try {
        groupRecord = await pbClient.getGroup(groupId);
      } catch (err) {
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
        members: existingMembers,
      };

      // Save group and key locally
      await db.saveGroup(group);
      await db.saveGroupKey(groupId, groupKeyBase64);

      // Add member to Loro (with alias if claiming existing member)
      const versionBefore = newLoroStore.getVersion();

      if (existingMemberId) {
        // Claiming an existing virtual member identity
        const existingMember = existingMembers.find(m => m.id === existingMemberId);
        if (!existingMember) {
          throw new Error('Selected member not found');
        }

        // Add the new real member
        const newMember: Member = {
          id: currentIdentity.publicKeyHash,
          name: memberName,
          publicKey: currentIdentity.publicKey,
          joinedAt: Date.now(),
          status: 'active',
          isVirtual: false,
        };
        newLoroStore.addMember(newMember);

        // Create member alias linking new ID to existing ID
        const alias: MemberAlias = {
          newMemberId: currentIdentity.publicKeyHash,
          existingMemberId: existingMemberId,
          linkedAt: Date.now(),
          linkedBy: currentIdentity.publicKeyHash,
        };
        newLoroStore.addMemberAlias(alias);

        console.log('[AppContext] Created member alias:', alias);
      } else {
        // New member (not claiming existing identity)
        const newMember: Member = {
          id: currentIdentity.publicKeyHash,
          name: memberName,
          publicKey: currentIdentity.publicKey,
          joinedAt: Date.now(),
          status: 'active',
          isVirtual: false,
        };
        newLoroStore.addMember(newMember);

        console.log('[AppContext] Added new member:', newMember);
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
      }

      // Update the group with filtered members (excluding replaced virtual members)
      const finalAliases = newLoroStore.getMemberAliases();
      const finalReplacedMemberIds = new Set(finalAliases.map(a => a.existingMemberId));
      const finalMembers = newLoroStore.getMembers().filter(m => {
        if (!m.isVirtual) return true;
        return !finalReplacedMemberIds.has(m.id);
      });
      const updatedGroup = { ...group, members: finalMembers };
      await db.saveGroup(updatedGroup);

      // Update groups list
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);

      // Select the new group
      await selectGroup(groupId);

      console.log('[AppContext] Successfully joined group:', groupId);
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
      console.log('[AppContext] Manual sync started');

      // Perform incremental sync
      await manager.incrementalSync(group.id, currentIdentity.publicKeyHash);

      // Refresh entries
      await refreshEntries(group.id, group.currentKeyVersion);

      // Update sync state
      setSyncState(manager.getState());

      console.log('[AppContext] Manual sync completed');
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
    console.log('[AppContext] Auto-sync:', autoSyncEnabled() ? 'enabled' : 'disabled');
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

      console.log('[importGroups] Starting import analysis...');

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
        console.log('[importGroups] JSON parsed successfully');
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

      console.log('[importGroups] Found', importData.groups.length, 'groups to analyze');

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
            console.log(
              `[importGroups] ${groupExport.group.name} - Local snapshot size before:`,
              localSnapshotBefore.byteLength
            );

            testStoreLocal.importSnapshot(groupExport.loroSnapshot);
            const localSnapshotAfter = testStoreLocal.exportSnapshot();
            console.log(
              `[importGroups] ${groupExport.group.name} - Local snapshot size after importing remote:`,
              localSnapshotAfter.byteLength
            );

            const importHasNewData =
              localSnapshotBefore.byteLength !== localSnapshotAfter.byteLength;
            console.log(
              `[importGroups] ${groupExport.group.name} - Import has new data:`,
              importHasNewData
            );

            // Test 2: Does local have new data not in import?
            // Load import snapshot, compare snapshot sizes after importing local
            const testStoreImport = new LoroEntryStore(currentIdentity.publicKeyHash);
            testStoreImport.importSnapshot(groupExport.loroSnapshot);
            const importSnapshotBefore = testStoreImport.exportSnapshot();
            console.log(
              `[importGroups] ${groupExport.group.name} - Import snapshot size before:`,
              importSnapshotBefore.byteLength
            );

            testStoreImport.importSnapshot(existingSnapshot);
            const importSnapshotAfter = testStoreImport.exportSnapshot();
            console.log(
              `[importGroups] ${groupExport.group.name} - Import snapshot size after loading local:`,
              importSnapshotAfter.byteLength
            );

            const localHasNewData =
              importSnapshotBefore.byteLength !== importSnapshotAfter.byteLength;
            console.log(
              `[importGroups] ${groupExport.group.name} - Local has new data:`,
              localHasNewData
            );

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

            console.log(
              `[importGroups] Group ${groupExport.group.name}: importHasNewData=${importHasNewData}, localHasNewData=${localHasNewData}, relationship=${relationship}`
            );

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

      console.log('[importGroups] Analysis complete, returning', analysis.length, 'groups');

      const result = {
        groups: analysis,
        exportData: importData,
      };

      console.log('[importGroups] Returning result:', result);
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

          console.log(`[AppContext] Imported new group: ${groupExport.group.name}`);
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

            // Update members from merged Loro (filter out replaced virtual members)
            const mergedMembers = mergedStore.getMembers();
            const mergedAliases = mergedStore.getMemberAliases();
            const mergedReplacedMemberIds = new Set(mergedAliases.map(a => a.existingMemberId));

            const filteredMergedMembers = mergedMembers.filter(m => {
              if (!m.isVirtual) return true;
              return !mergedReplacedMemberIds.has(m.id);
            });

            const updatedGroup = { ...existingGroup, members: filteredMergedMembers };
            await db.saveGroup(updatedGroup);
          } else {
            // No existing snapshot - just import (get version from imported snapshot)
            const tempStore2 = new LoroEntryStore(currentIdentity.publicKeyHash);
            tempStore2.importSnapshot(groupExport.loroSnapshot);
            const importVersion2 = tempStore2.getVersion();
            await db.saveLoroSnapshot(groupExport.group.id, groupExport.loroSnapshot, importVersion2);
          }

          // Import key if missing
          const existingKey = await db.getGroupKey(groupExport.group.id);
          if (!existingKey) {
            await db.saveGroupKey(groupExport.group.id, groupExport.key);
          }

          console.log(`[AppContext] Merged group: ${groupExport.group.name}`);
        }
      }

      // Refresh groups list
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);

      console.log(`[AppContext] Successfully imported ${importData.groups.length} group(s)`);
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

      console.log(`[AppContext] Deleted group: ${groupId}`);
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

      console.log('[AppContext] Updated settlement preferences for user:', userId);

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

          console.log('[AppContext] Settlement preference synced to server');
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

  /**
   * Add a virtual member to the active group
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

      // Generate unique ID for virtual member
      const virtualMemberId = crypto.randomUUID();

      const newMember: Member = {
        id: virtualMemberId,
        name,
        joinedAt: Date.now(),
        status: 'active',
        isVirtual: true,
        addedBy: currentIdentity.publicKeyHash,
      };

      // Add to Loro store
      const versionBefore = store.getVersion();
      store.addMember(newMember);

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

      // Refresh members by updating the active group (filter out replaced virtual members)
      const allMembers = store.getMembers();
      const aliases = store.getMemberAliases();
      const replacedMemberIds = new Set(aliases.map(a => a.existingMemberId));

      const filteredMembers = allMembers.filter(m => {
        if (!m.isVirtual) return true;
        return !replacedMemberIds.has(m.id);
      });

      const updatedGroup = { ...group, members: filteredMembers };
      setActiveGroup(updatedGroup);
      await db.saveGroup(updatedGroup);

      console.log('[AppContext] Virtual member added:', newMember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Rename a member in the active group
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

      // Update in Loro store
      const versionBefore = store.getVersion();
      store.updateMember(memberId, { name: newName });

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

      // Refresh members (filter out replaced virtual members)
      const allMembers = store.getMembers();
      const aliases = store.getMemberAliases();
      const replacedMemberIds = new Set(aliases.map(a => a.existingMemberId));

      const filteredMembers = allMembers.filter(m => {
        if (!m.isVirtual) return true;
        return !replacedMemberIds.has(m.id);
      });

      const updatedGroup = { ...group, members: filteredMembers };
      setActiveGroup(updatedGroup);
      await db.saveGroup(updatedGroup);

      console.log('[AppContext] Member renamed:', memberId, 'to', newName);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename member');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Remove a member from the active group (mark as departed)
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

      // Update member status to departed
      const versionBefore = store.getVersion();
      store.updateMember(memberId, {
        status: 'departed',
        leftAt: Date.now(),
      });

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

      // Refresh members (filter out replaced virtual members)
      const allMembers = store.getMembers();
      const aliases = store.getMemberAliases();
      const replacedMemberIds = new Set(aliases.map(a => a.existingMemberId));

      const filteredMembers = allMembers.filter(m => {
        if (!m.isVirtual) return true;
        return !replacedMemberIds.has(m.id);
      });

      const updatedGroup = { ...group, members: filteredMembers };
      setActiveGroup(updatedGroup);
      await db.saveGroup(updatedGroup);

      console.log('[AppContext] Member removed:', memberId);
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

      // Get active entries and calculate balances
      const activeEntries = await tempStore.getActiveEntries(groupId, groupKey);
      const memberAliases = tempStore.getMemberAliases();
      const calculatedBalances = calculateBalances(activeEntries, memberAliases);

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
    members,
    addVirtualMember,
    renameMember,
    removeMember,
    entries,
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
