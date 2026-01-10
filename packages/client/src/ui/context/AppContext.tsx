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
import { generateAllActivities, filterActivities } from '../../domain/calculations/activity-generator';
import { SyncManager, type SyncState } from '../../core/sync';
import { pbClient } from '../../api';
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
  JoinRequest,
  Activity,
  ActivityFilter,
  EntryFilter,
} from '@partage/shared';
import { createJoinRequest as createJoinRequestUtil } from '../../domain/invitations/invite-manager';
import { processJoinRequest as processJoinRequestUtil } from '../../domain/invitations/invite-manager';
import { buildGroupKeysPayload, importGroupKeys } from '../../domain/invitations/key-sharing';
import { importKeypair } from '../../core/crypto/keypair';
import { importSigningKeypair } from '../../core/crypto/signatures';
import { verifyAndDecryptKeyPackage } from '../../core/crypto/key-exchange';

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
  createGroup: (name: string, currency: string, members: Member[]) => Promise<void>;
  selectGroup: (groupId: string) => Promise<void>;
  deselectGroup: () => void;

  // Members for active group
  members: Accessor<Member[]>;

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

  // Activities (derived from entries and members)
  activities: Accessor<Activity[]>;
  activityFilter: Accessor<ActivityFilter>;
  setActivityFilter: (filter: ActivityFilter) => void;

  // Invitations & Multi-User (Phase 5)
  createInvitation: (groupId: string, groupName: string) => Promise<{ inviteLink: string }>;
  submitJoinRequest: (invitationId: string, groupId: string, userName: string) => Promise<void>;
  pendingJoinRequests: Accessor<any[]>; // JoinRequest[] from @partage/shared
  approveJoinRequest: (requestId: string) => Promise<void>;

  // Sync state and controls
  syncState: Accessor<SyncState>;
  manualSync: () => Promise<void>;
  toggleAutoSync: () => void;

  // UI state
  isLoading: Accessor<boolean>;
  error: Accessor<string | null>;
  clearError: () => void;
}

// Create context
const AppContext = createContext<AppContextValue>();

// Provider component
export const AppProvider: Component<{ children: JSX.Element }> = (props) => {
  console.log('[AppProvider] Component rendering...');
  const db = getDB();
  console.log('[AppProvider] Database instance created');

  // Core state
  const [identity, setIdentity] = createSignal<SerializedKeypair | null>(null);
  const [groups, setGroups] = createSignal<Group[]>([]);
  const [activeGroup, setActiveGroup] = createSignal<Group | null>(null);
  const [loroStore, setLoroStore] = createSignal<LoroEntryStore | null>(null);
  const [syncManager, setSyncManager] = createSignal<SyncManager | null>(null);

  // Derived state
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [balances, setBalances] = createSignal<Map<string, Balance>>(new Map());

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
  const [pendingJoinRequests, setPendingJoinRequests] = createSignal<JoinRequest[]>([]);

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

  // Members for active group (all members: real + virtual)
  const members = createMemo(() => {
    const group = activeGroup();
    if (!group) {
      console.log('[AppContext] members() called but no active group');
      return [];
    }
    const membersList = group.members || [];
    console.log('[AppContext] members() returning:', membersList);
    return membersList;
  });

  // Settlement plan (memoized)
  const settlementPlan = createMemo(() => {
    const currentBalances = balances();
    if (currentBalances.size === 0) {
      return { transactions: [], totalTransactions: 0 };
    }
    return generateSettlementPlan(currentBalances);
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
  const createGroup = async (name: string, currency: string, virtualMembers: Member[]) => {
    console.log('[AppContext] createGroup called with:', { name, currency, virtualMembers });
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
            name: 'You',
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
        name: 'You',
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
      await db.saveGroupKey(groupId, 1, exportedKey);

      const initialSnapshot = newLoroStore.exportSnapshot();
      await db.saveLoroSnapshot(groupId, initialSnapshot);

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
          console.log('[AppContext] Initial state pushed to server, bytes:', updateBytes.byteLength);

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

      // Load Loro snapshot
      const snapshot = await db.getLoroSnapshot(groupId);
      const store = new LoroEntryStore(currentIdentity.publicKeyHash);

      if (snapshot) {
        store.importSnapshot(snapshot);
      }

      // Sync members from Loro to group object
      const members = store.getMembers();
      const updatedGroup = { ...group, members };
      if (members.length > 0) {
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

            // Update members from Loro
            const updatedMembers = store.getMembers();
            const refreshedGroup = { ...group, members: updatedMembers };
            await db.saveGroup(refreshedGroup);
            setActiveGroup(refreshedGroup);
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
          const syncedMembers = store.getMembers();
          const syncedGroup = { ...updatedGroup, members: syncedMembers };
          if (syncedMembers.length > 0) {
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

      // Fetch and subscribe to join requests (for existing members)
      if (navigator.onLine) {
        try {
          // Fetch existing pending join requests
          try {
            const existingRequests = await pbClient.listJoinRequests(groupId, {
              status: 'pending',
            });
            const typedRequests: JoinRequest[] = existingRequests.map((req) => ({
              id: req.id,
              invitationId: req.invitationId,
              groupId: req.groupId,
              requesterPublicKey: req.requesterPublicKey,
              requesterPublicKeyHash: req.requesterPublicKeyHash,
              requesterName: req.requesterName,
              requestedAt: req.requestedAt,
              status: req.status as 'pending' | 'approved' | 'rejected',
              approvedBy: req.approvedBy,
              approvedAt: req.approvedAt,
              rejectedBy: req.rejectedBy,
              rejectedAt: req.rejectedAt,
              rejectionReason: req.rejectionReason,
            }));
            setPendingJoinRequests(typedRequests);
            console.log('[AppContext] Loaded pending join requests:', typedRequests.length);
          } catch (fetchErr) {
            // Collection might not exist yet or no records - that's ok
            console.log(
              '[AppContext] Could not fetch join requests (collection may not exist):',
              fetchErr
            );
            setPendingJoinRequests([]);
          }

          // Subscribe to new join requests
          try {
            await pbClient.subscribeToJoinRequests(groupId, (joinRequest) => {
              console.log('[AppContext] New join request received:', joinRequest);
              const typedRequest: JoinRequest = {
                id: joinRequest.id,
                invitationId: joinRequest.invitationId,
                groupId: joinRequest.groupId,
                requesterPublicKey: joinRequest.requesterPublicKey,
                requesterPublicKeyHash: joinRequest.requesterPublicKeyHash,
                requesterName: joinRequest.requesterName,
                requestedAt: joinRequest.requestedAt,
                status: joinRequest.status as 'pending' | 'approved' | 'rejected',
                approvedBy: joinRequest.approvedBy,
                approvedAt: joinRequest.approvedAt,
                rejectedBy: joinRequest.rejectedBy,
                rejectedAt: joinRequest.rejectedAt,
                rejectionReason: joinRequest.rejectionReason,
              };
              setPendingJoinRequests((prev) => [...prev, typedRequest]);
            });
          } catch (subscribeErr) {
            console.log('[AppContext] Could not subscribe to join requests:', subscribeErr);
          }
        } catch (err) {
          console.warn('[AppContext] Failed to setup join requests:', err);
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

    // Clear pending join requests
    setPendingJoinRequests([]);

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
  const refreshEntries = async (groupId: string, keyVersion: number) => {
    try {
      const store = loroStore();
      if (!store) return;

      // Best-effort: pass the current group key as the first decryption attempt.
      // Proper rotation support is implemented in the store by falling back to the
      // per-entry `keyVersion` lookup when this key doesn't work.
      const keyString = await db.getGroupKey(groupId, keyVersion);
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
      const calculatedBalances = calculateBalances(activeEntries);
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
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Create expense entry
      // IMPORTANT (key rotation): record the group key version used for encryption.
      // This is not part of the shared `Entry` type yet, so we attach it as an
      // internal field consumed by `LoroEntryStore.splitEntry(...)`.
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
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion);
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
      await db.saveLoroSnapshot(group.id, store.exportSnapshot());

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Add transfer
  const addTransfer = async (data: TransferFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Create transfer entry
      // IMPORTANT (key rotation): record the group key version used for encryption.
      // This is not part of the shared `Entry` type yet, so we attach it as an
      // internal field consumed by `LoroEntryStore.splitEntry(...)`.
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
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion);
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
      await db.saveLoroSnapshot(group.id, store.exportSnapshot());

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add transfer');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Modify expense (creates new version)
  const modifyExpense = async (originalId: string, data: ExpenseFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion);
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
      await db.saveLoroSnapshot(group.id, store.exportSnapshot());

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);

      // Clear editing state
      setEditingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to modify expense');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Modify transfer (creates new version)
  const modifyTransfer = async (originalId: string, data: TransferFormData) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion);
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
      await db.saveLoroSnapshot(group.id, store.exportSnapshot());

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);

      // Clear editing state
      setEditingEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to modify transfer');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Delete entry (soft delete - creates new version with status=deleted)
  const deleteEntry = async (entryId: string, reason?: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion);
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
      await db.saveLoroSnapshot(group.id, store.exportSnapshot());

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Undelete entry (restore deleted entry - creates new version with status=active)
  const undeleteEntry = async (entryId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const currentIdentity = identity();
      const group = activeGroup();
      const store = loroStore();

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store');
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion);
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
      await db.saveLoroSnapshot(group.id, store.exportSnapshot());

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undelete entry');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  // Phase 5: Create invitation for a group
  const createInvitation = async (groupId: string, groupName: string) => {
    try {
      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found');
      }

      // Get signing keypair from storage
      const storedKeypairs = await db.getUserKeypair();
      if (!storedKeypairs?.signingKeypair) {
        throw new Error('Signing keypair not found');
      }

      // Save invitation to server first to get PocketBase-generated ID
      if (!navigator.onLine) {
        throw new Error('Must be online to create invitations');
      }

      const invitationRecord = await pbClient.createInvitation({
        groupId: groupId,
        inviterPublicKeyHash: currentIdentity.publicKeyHash,
        createdAt: Date.now(),
        usedCount: 0,
        status: 'active',
      });

      // Create invite link using the PocketBase-generated ID
      const linkData = {
        invitationId: invitationRecord.id,
        groupId,
        groupName,
      };
      const linkDataJSON = JSON.stringify(linkData);
      const linkDataBase64 = btoa(linkDataJSON);
      const inviteLink = `${window.location.origin}/join/${linkDataBase64}`;

      return { inviteLink };
    } catch (err) {
      console.error('Failed to create invitation:', err);
      throw err;
    }
  };

  // Phase 5: Submit join request (for new users)
  const submitJoinRequest = async (invitationId: string, groupId: string, userName: string) => {
    try {
      const currentIdentity = identity();
      if (!currentIdentity) {
        throw new Error('No identity found');
      }

      const userKeypair = await importKeypair(currentIdentity);

      const joinRequest = await createJoinRequestUtil(invitationId, groupId, userKeypair, userName);

      // Submit to server
      if (navigator.onLine) {
        const createdRequest = await pbClient.createJoinRequest({
          invitationId: joinRequest.invitationId,
          groupId: joinRequest.groupId,
          requesterPublicKey: joinRequest.requesterPublicKey,
          requesterPublicKeyHash: joinRequest.requesterPublicKeyHash,
          requesterName: joinRequest.requesterName,
          requestedAt: joinRequest.requestedAt,
          status: joinRequest.status,
        });

        console.log('Join request created with ID:', createdRequest.id);

        // Subscribe to key packages for this user
        await pbClient.subscribeToKeyPackages(currentIdentity.publicKeyHash, async (keyPackage) => {
          console.log('Received key package:', keyPackage);
          // Process the key package
          await processReceivedKeyPackage(keyPackage);
        });
      }
    } catch (err) {
      console.error('Failed to submit join request:', err);
      throw err;
    }
  };

  // Phase 5: Process received key package
  const processReceivedKeyPackage = async (keyPackageRecord: any) => {
    try {
      const currentIdentity = identity();
      const storedKeypairs = await db.getUserKeypair();

      if (!currentIdentity || !storedKeypairs?.signingKeypair) {
        throw new Error('Missing identity or signing keypair');
      }

      const userKeypair = await importKeypair(currentIdentity);

      // Use sender's public keys for decryption and verification
      const senderPublicKey = keyPackageRecord.senderPublicKey;
      const senderSigningKey = keyPackageRecord.senderSigningPublicKey;

      // Verify and decrypt
      const payload = await verifyAndDecryptKeyPackage(
        keyPackageRecord.encryptedKeys,
        keyPackageRecord.signature,
        senderPublicKey, // Sender's ECDH public key for decryption
        senderSigningKey, // Sender's signing public key for verification
        userKeypair.privateKey
      );

      // Import group keys
      await importGroupKeys(payload);

      // Fetch group metadata and join request
      const groupRecord = await pbClient.getGroup(payload.groupId);
      const joinRequest = await pbClient.getJoinRequest(keyPackageRecord.joinRequestId);

      // Initialize or load Loro CRDT for this group
      const newLoroStore = new LoroEntryStore(currentIdentity.publicKeyHash);
      const existingSnapshot = await db.getLoroSnapshot(payload.groupId);
      if (existingSnapshot) {
        newLoroStore.importSnapshot(existingSnapshot);
      }

      // Add new member to Loro CRDT
      const newMember: Member = {
        id: currentIdentity.publicKeyHash,
        name: joinRequest.requesterName,
        publicKey: joinRequest.requesterPublicKey,
        joinedAt: Date.now(),
        status: 'active',
        isVirtual: false,
      };
      newLoroStore.addMember(newMember);

      // Initialize sync manager for this group and do initial sync FIRST
      // This ensures we get all existing entries and members before saving
      const manager = new SyncManager({
        loroStore: newLoroStore,
        storage: db,
        apiClient: pbClient,
        enableAutoSync: true,
        onUpdate: async (updatedGroupId) => {
          console.log('[AppContext] New member received update for group:', updatedGroupId);
        },
      });

      console.log('[AppContext] New member starting initial sync...');
      await manager.initialSync(payload.groupId, currentIdentity.publicKeyHash);
      console.log('[AppContext] New member initial sync completed');

      // CRITICAL: Push our local state (including our member add) to the server
      // This ensures other peers can properly import our future updates,
      // since Loro updates may have causal dependencies on our local operations.
      const versionAfterSync = newLoroStore.getVersion();
      const ourStateUpdate = newLoroStore.exportSnapshot(); // Export full state to ensure compatibility
      console.log(
        '[AppContext] New member pushing local state to server, bytes:',
        ourStateUpdate.byteLength
      );
      await manager.pushUpdate(
        payload.groupId,
        currentIdentity.publicKeyHash,
        ourStateUpdate,
        versionAfterSync
      );

      // Now get all members from Loro (includes members from synced data)
      const allMembers = newLoroStore.getMembers();
      console.log('[AppContext] Members after sync:', allMembers.length);

      // Save final Loro snapshot (with all synced data)
      const finalSnapshot = newLoroStore.exportSnapshot();
      await db.saveLoroSnapshot(payload.groupId, finalSnapshot);

      // Convert to Group type with all required fields
      const group: Group = {
        id: groupRecord.id,
        name: groupRecord.name,
        defaultCurrency: 'USD', // Default currency for now
        createdAt: groupRecord.createdAt,
        createdBy: groupRecord.createdBy,
        currentKeyVersion: payload.currentKeyVersion,
        settings: {
          anyoneCanAddEntries: true,
          anyoneCanModifyEntries: true,
          anyoneCanDeleteEntries: true,
          anyoneCanInvite: true,
          anyoneCanShareKeys: true,
        },
        members: allMembers,
      };

      // Save group to local storage
      await db.saveGroup(group);
      console.log('[AppContext] Successfully joined group:', group.name);

      // Properly destroy the temporary sync manager before navigation
      // (the subscription callback won't be useful after navigation anyway)
      await manager.destroy();

      // Refresh groups list
      const allGroups = await db.getAllGroups();
      setGroups(allGroups);

      // Navigate to the new group - use router if available, otherwise fallback
      // Small delay to ensure all IndexedDB writes are flushed
      await new Promise((resolve) => setTimeout(resolve, 100));
      window.location.href = '/';
    } catch (err) {
      console.error('Failed to process key package:', err);
      throw err;
    }
  };

  // Phase 5: Approve join request (for existing members)
  const approveJoinRequest = async (requestId: string) => {
    try {
      const currentIdentity = identity();
      const storedKeypairs = await db.getUserKeypair();
      const group = activeGroup();

      if (!currentIdentity || !storedKeypairs?.signingKeypair || !group) {
        throw new Error('Missing identity, signing keypair, or active group');
      }

      if (!navigator.onLine) {
        throw new Error('Must be online to approve join requests');
      }

      // Get the join request
      const joinRequest = await pbClient.getJoinRequest(requestId);

      // Import keypairs
      const userKeypair = await importKeypair(currentIdentity);
      const signingKeypair = await importSigningKeypair(storedKeypairs.signingKeypair);

      // Add new member to Loro CRDT (so membership is consistent before rotation)
      const store = loroStore();
      const manager = syncManager();

      if (store) {
        const newMember: Member = {
          id: joinRequest.requesterPublicKeyHash,
          name: joinRequest.requesterName,
          publicKey: joinRequest.requesterPublicKey,
          joinedAt: Date.now(),
          status: 'active',
          isVirtual: false,
        };

        const versionBefore = store.getVersion();
        store.addMember(newMember);

        // Push the member update to server
        if (manager) {
          const updateBytes = store.exportFrom(versionBefore);
          await manager.pushUpdate(
            group.id,
            currentIdentity.publicKeyHash,
            updateBytes,
            versionBefore
          );
        }

        // Update local group members list
        const updatedMembers = store.getMembers();
        const updatedGroup = { ...group, members: updatedMembers };
        await db.saveGroup(updatedGroup);
        setActiveGroup(updatedGroup);
      }

      // =========================
      // Proper key rotation on join
      // =========================
      // Generate a new group key version locally and persist it.
      //
      // IMPORTANT: keep the previous current key version available locally before rotating.
      // If the local key history is incomplete (e.g. missing v1), rotating would make
      // previously created entries undecryptable and/or cause decryption failures.
      const previousKeyVersion = group.currentKeyVersion;
      const previousKey = await db.getGroupKey(group.id, previousKeyVersion);
      if (!previousKey) {
        throw new Error(
          `Cannot rotate keys: missing previous group key v${previousKeyVersion} in local storage`
        );
      }

      const newKeyVersion = previousKeyVersion + 1;
      const newGroupKey = await generateSymmetricKey();
      const exportedNewKey = await exportSymmetricKey(newGroupKey);
      await db.saveGroupKey(group.id, newKeyVersion, exportedNewKey);

      // Build a payload that includes *all* historical keys (including the previous current key)
      // and sets currentKeyVersion=newKeyVersion.
      // This payload will be encrypted separately for each real member.
      const rotatedKeysPayload = await buildGroupKeysPayload(
        group.id,
        newKeyVersion,
        currentIdentity.publicKeyHash
      );

      // Determine real members (non-virtual) that must receive the rotated key package,
      // including: existing real members + the newly approved member.
      const currentMembers = (activeGroup()?.members || []).filter((m) => !m.isVirtual);
      const recipients: Member[] = (() => {
        const byId = new Map<string, Member>();
        for (const m of currentMembers) byId.set(m.id, m);
        byId.set(joinRequest.requesterPublicKeyHash, {
          id: joinRequest.requesterPublicKeyHash,
          name: joinRequest.requesterName,
          publicKey: joinRequest.requesterPublicKey,
          joinedAt: Date.now(),
          status: 'active',
          isVirtual: false,
        });
        return Array.from(byId.values()).filter((m) => !!m.publicKey);
      })();

      // Create a key package for each recipient.
      // Note: Each package is encrypted to the recipient, so we use JoinRequest-shaped input for each.
      for (const recipient of recipients) {
        const recipientJoinRequest: JoinRequest = {
          id: requestId,
          invitationId: joinRequest.invitationId,
          groupId: group.id,
          requesterPublicKey: recipient.publicKey as string,
          requesterPublicKeyHash: recipient.id,
          requesterName: recipient.name,
          requestedAt: Date.now(),
          status: 'approved',
          approvedBy: currentIdentity.publicKeyHash,
          approvedAt: Date.now(),
        };

        const pkg = await processJoinRequestUtil(
          recipientJoinRequest,
          rotatedKeysPayload,
          userKeypair,
          signingKeypair
        );

        const keyPackageData = {
          joinRequestId: requestId,
          groupId: pkg.groupId,
          recipientPublicKeyHash: pkg.recipientPublicKeyHash,

          // Key rotation metadata (required by updated PocketBase schema)
          keyVersion: rotatedKeysPayload.currentKeyVersion,
          reason: 'rotate',

          senderPublicKeyHash: pkg.senderPublicKeyHash,
          senderPublicKey: pkg.senderPublicKey,
          senderSigningPublicKey: pkg.senderSigningPublicKey,
          encryptedKeys: pkg.encryptedKeys,
          createdAt: pkg.createdAt,
          signature: pkg.signature,
        };

        await pbClient.createKeyPackage(keyPackageData);
      }

      // Mark join request approved on server
      await pbClient.updateJoinRequest(requestId, {
        status: 'approved',
        approvedBy: currentIdentity.publicKeyHash,
        approvedAt: Date.now(),
      });

      // Remove from pending list
      setPendingJoinRequests((prev) => prev.filter((req) => req.id !== requestId));

      // Update local group currentKeyVersion and persist (this is the version new entries must use).
      const finalGroup = { ...(activeGroup() || group), currentKeyVersion: newKeyVersion };
      await db.saveGroup(finalGroup);
      setActiveGroup(finalGroup);

      // As a safety measure, ensure we still have the previous key version stored locally
      // so older entries remain decryptable after rotation.
      const stillHasPreviousKey = await db.getGroupKey(group.id, previousKeyVersion);
      if (!stillHasPreviousKey) {
        console.warn(
          `[AppContext] Key rotation completed but previous key v${previousKeyVersion} is missing locally; older entries may fail to decrypt`
        );
      }

      console.log(
        `[AppContext] Rotated group key from v${previousKeyVersion} to v${newKeyVersion} and distributed to ${recipients.length} real members`
      );
    } catch (err) {
      console.error('Failed to approve join request:', err);
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
    activities,
    activityFilter,
    setActivityFilter,
    createInvitation,
    submitJoinRequest,
    pendingJoinRequests,
    approveJoinRequest,
    syncState,
    manualSync,
    toggleAutoSync,
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
