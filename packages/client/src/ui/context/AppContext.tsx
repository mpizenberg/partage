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
} from 'solid-js'
import { PartageDB, getDB } from '../../core/storage/indexeddb'
import { LoroEntryStore } from '../../core/crdt/loro-wrapper'
import { calculateBalances, generateSettlementPlan } from '../../domain/calculations/balance-calculator'
import { SyncManager, type SyncState } from '../../core/sync'
import { pbClient } from '../../api'
import {
  generateKeypair,
  exportKeypair,
  generateSigningKeypair,
  exportSigningKeypair,
  generateSymmetricKey,
  exportSymmetricKey,
  importSymmetricKey,
} from '../../core/crypto'
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
} from '@partage/shared'

// Expense form data interface
export interface ExpenseFormData {
  description: string
  amount: number
  currency: string
  date: number
  category?: ExpenseCategory
  location?: string
  notes?: string
  payers: Array<{ memberId: string; amount: number }>
  beneficiaries: Array<{
    memberId: string
    splitType: 'shares' | 'exact'
    shares?: number
    amount?: number
  }>
}

// Transfer form data interface
export interface TransferFormData {
  amount: number
  currency: string
  from: string
  to: string
  date: number
  notes?: string
}

// App context interface
interface AppContextValue {
  // Core services
  db: PartageDB
  loroStore: Accessor<LoroEntryStore | null>
  syncManager: Accessor<SyncManager | null>

  // User identity
  identity: Accessor<SerializedKeypair | null>
  initializeIdentity: () => Promise<void>

  // Groups
  groups: Accessor<Group[]>
  activeGroup: Accessor<Group | null>
  createGroup: (name: string, currency: string, members: Member[]) => Promise<void>
  selectGroup: (groupId: string) => Promise<void>
  deselectGroup: () => void

  // Members for active group
  members: Accessor<Member[]>

  // Entries (derived from Loro)
  entries: Accessor<Entry[]>
  addExpense: (data: ExpenseFormData) => Promise<void>
  addTransfer: (data: TransferFormData) => Promise<void>

  // Balances (derived from entries)
  balances: Accessor<Map<string, Balance>>
  settlementPlan: Accessor<SettlementPlan>

  // Sync state and controls
  syncState: Accessor<SyncState>
  manualSync: () => Promise<void>
  toggleAutoSync: () => void

  // UI state
  isLoading: Accessor<boolean>
  error: Accessor<string | null>
  clearError: () => void
}

// Create context
const AppContext = createContext<AppContextValue>()

// Provider component
export const AppProvider: Component<{ children: JSX.Element }> = (props) => {
  console.log('[AppProvider] Component rendering...')
  const db = getDB()
  console.log('[AppProvider] Database instance created')

  // Core state
  const [identity, setIdentity] = createSignal<SerializedKeypair | null>(null)
  const [groups, setGroups] = createSignal<Group[]>([])
  const [activeGroup, setActiveGroup] = createSignal<Group | null>(null)
  const [loroStore, setLoroStore] = createSignal<LoroEntryStore | null>(null)
  const [syncManager, setSyncManager] = createSignal<SyncManager | null>(null)

  // Derived state
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [balances, setBalances] = createSignal<Map<string, Balance>>(new Map())

  // Sync state
  const [syncState, setSyncState] = createSignal<SyncState>({
    status: 'idle',
    lastSyncTimestamp: null,
    lastError: null,
    isOnline: navigator.onLine,
    activeSubscriptions: 0,
  })
  const [autoSyncEnabled, setAutoSyncEnabled] = createSignal(true)

  // UI state
  const [isLoading, setIsLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  // Members for active group (all members: real + virtual)
  const members = createMemo(() => {
    const group = activeGroup()
    if (!group) {
      console.log('[AppContext] members() called but no active group')
      return []
    }
    const membersList = group.members || []
    console.log('[AppContext] members() returning:', membersList)
    return membersList
  })

  // Settlement plan (memoized)
  const settlementPlan = createMemo(() => {
    const currentBalances = balances()
    if (currentBalances.size === 0) {
      return { transactions: [], totalTransactions: 0 }
    }
    return generateSettlementPlan(currentBalances)
  })

  // Initialize database and load data
  onMount(async () => {
    console.log('[AppContext] onMount - initializing app...')
    try {
      setIsLoading(true)

      // Open database
      await db.open()
      console.log('[AppContext] Database opened')

      // Load user identity
      const storedIdentity = await db.getUserKeypair()
      setIdentity(storedIdentity?.keypair || null)

      // Load all groups
      const allGroups = await db.getAllGroups()
      setGroups(allGroups)

      // Check server connectivity
      const isServerReachable = await pbClient.healthCheck()
      console.log('[AppContext] Server reachable:', isServerReachable)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize app')
      console.error('Initialization error:', err)
    } finally {
      setIsLoading(false)
    }
  })

  // Cleanup on unmount
  onCleanup(async () => {
    const manager = syncManager()
    if (manager) {
      await manager.destroy()
    }
  })

  // Initialize identity (first-time setup)
  const initializeIdentity = async () => {
    try {
      setIsLoading(true)
      setError(null)

      // Generate keypairs
      const keypair = await generateKeypair()
      const signingKeypair = await generateSigningKeypair()

      // Export for storage
      const exportedKeypair = await exportKeypair(keypair)
      const exportedSigningKeypair = await exportSigningKeypair(signingKeypair)

      // Save to database
      await db.saveUserKeypair(exportedKeypair, exportedSigningKeypair)

      // Update state
      setIdentity(exportedKeypair)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate identity')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  // Create new group
  const createGroup = async (name: string, currency: string, virtualMembers: Member[]) => {
    console.log('[AppContext] createGroup called with:', { name, currency, virtualMembers })
    try {
      setIsLoading(true)
      setError(null)

      const currentIdentity = identity()
      if (!currentIdentity) {
        throw new Error('No identity found. Please initialize identity first.')
      }
      console.log('[AppContext] Current identity:', currentIdentity.publicKeyHash)

      // Generate group ID and key
      const groupId = crypto.randomUUID()
      const groupKey = await generateSymmetricKey()
      const exportedKey = await exportSymmetricKey(groupKey)

      // Default group settings
      const defaultSettings: GroupSettings = {
        anyoneCanAddEntries: true,
        anyoneCanModifyEntries: true,
        anyoneCanDeleteEntries: true,
        anyoneCanInvite: true,
        anyoneCanShareKeys: true,
      }

      // Create group object
      const group: Group = {
        id: groupId,
        name,
        defaultCurrency: currency,
        createdAt: Date.now(),
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
      }

      // Save to database
      console.log('[AppContext] Saving group with members:', group.members)
      await db.saveGroup(group)
      await db.saveGroupKey(groupId, 1, exportedKey)

      // Initialize Loro store with empty snapshot
      const newLoroStore = new LoroEntryStore()
      await db.saveLoroSnapshot(groupId, newLoroStore.exportSnapshot())

      // Sync group to server if online
      if (navigator.onLine) {
        try {
          await pbClient.createGroup({
            name: group.name,
            createdAt: group.createdAt,
            createdBy: group.createdBy,
            lastActivityAt: Date.now(),
            memberCount: group.members?.length || 1,
          })
          console.log('[AppContext] Group synced to server')
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync group to server (continuing offline):', syncError)
        }
      }

      // Update groups list
      const updatedGroups = await db.getAllGroups()
      setGroups(updatedGroups)

      // Auto-select the new group
      await selectGroup(groupId)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create group')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  // Select group and load its data
  const selectGroup = async (groupId: string) => {
    try {
      setIsLoading(true)
      setError(null)

      const currentIdentity = identity()
      if (!currentIdentity) {
        throw new Error('No identity found')
      }

      // Get group from database
      const group = await db.getGroup(groupId)
      if (!group) {
        throw new Error('Group not found')
      }

      console.log('[AppContext] Loaded group from DB:', group)
      console.log('[AppContext] Group members:', group.members)

      // Load Loro snapshot
      const snapshot = await db.getLoroSnapshot(groupId)
      const store = new LoroEntryStore()

      if (snapshot) {
        store.importSnapshot(snapshot)
      }

      setLoroStore(store)
      setActiveGroup(group)
      console.log('[AppContext] Active group set, members:', activeGroup()?.members)

      // Initialize sync manager
      const manager = new SyncManager({
        loroStore: store,
        storage: db,
        apiClient: pbClient,
        enableAutoSync: autoSyncEnabled(),
      })
      setSyncManager(manager)

      // Load entries and calculate balances (before sync)
      await refreshEntries(groupId, group.currentKeyVersion)

      // Perform initial sync if online
      if (navigator.onLine && autoSyncEnabled()) {
        try {
          console.log('[AppContext] Starting initial sync...')
          await manager.initialSync(groupId, currentIdentity.publicKeyHash)

          // Subscribe to real-time updates
          await manager.subscribeToGroup(groupId, currentIdentity.publicKeyHash)

          // Refresh entries after sync
          await refreshEntries(groupId, group.currentKeyVersion)

          // Update sync state
          setSyncState(manager.getState())

          console.log('[AppContext] Initial sync completed')
        } catch (syncError) {
          console.warn('[AppContext] Sync failed, continuing in offline mode:', syncError)
          setSyncState(manager.getState())
        }
      } else {
        console.log('[AppContext] Offline mode - skipping sync')
      }

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  // Deselect active group
  const deselectGroup = async () => {
    // Cleanup sync manager
    const manager = syncManager()
    if (manager) {
      await manager.destroy()
      setSyncManager(null)
    }

    setActiveGroup(null)
    setLoroStore(null)
    setEntries([])
    setBalances(new Map())
    setSyncState({
      status: 'idle',
      lastSyncTimestamp: null,
      lastError: null,
      isOnline: navigator.onLine,
      activeSubscriptions: 0,
    })
  }

  // Refresh entries from Loro store
  const refreshEntries = async (groupId: string, keyVersion: number) => {
    try {
      const store = loroStore()
      if (!store) return

      // Get group key
      const keyString = await db.getGroupKey(groupId, keyVersion)
      if (!keyString) {
        throw new Error('Group key not found')
      }

      const groupKey = await importSymmetricKey(keyString)

      // Get all active entries
      const allEntries = await store.getActiveEntries(groupId, groupKey)
      setEntries(allEntries)

      // Calculate balances
      const calculatedBalances = calculateBalances(allEntries)
      setBalances(calculatedBalances)

    } catch (err) {
      console.error('Failed to refresh entries:', err)
      setError(err instanceof Error ? err.message : 'Failed to load entries')
    }
  }

  // Add expense
  const addExpense = async (data: ExpenseFormData) => {
    try {
      setIsLoading(true)
      setError(null)

      const currentIdentity = identity()
      const group = activeGroup()
      const store = loroStore()

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store')
      }

      // Create expense entry
      const entry: ExpenseEntry = {
        id: crypto.randomUUID(),
        groupId: group.id,
        type: 'expense',
        version: 1,
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
        defaultCurrencyAmount: data.amount, // For now, assume same currency
        exchangeRate: data.currency === group.defaultCurrency ? 1 : undefined,
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion)
      if (!keyString) {
        throw new Error('Group key not found')
      }
      const groupKey = await importSymmetricKey(keyString)

      // Add to Loro
      await store.createEntry(entry, groupKey, currentIdentity.publicKeyHash)

      // Get the Loro update to push to server
      const manager = syncManager()
      if (manager && autoSyncEnabled()) {
        try {
          // Export incremental update
          const version = store.getVersion()
          const updateBytes = store.exportFrom(version)

          // Push to server
          await manager.pushUpdate(group.id, currentIdentity.publicKeyHash, updateBytes, version)

          // Update sync state
          setSyncState(manager.getState())

          console.log('[AppContext] Expense synced to server')
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync expense, queued for later:', syncError)
        }
      }

      // Save snapshot
      await db.saveLoroSnapshot(group.id, store.exportSnapshot())

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add expense')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  // Add transfer
  const addTransfer = async (data: TransferFormData) => {
    try {
      setIsLoading(true)
      setError(null)

      const currentIdentity = identity()
      const group = activeGroup()
      const store = loroStore()

      if (!currentIdentity || !group || !store) {
        throw new Error('Invalid state: missing identity, group, or store')
      }

      // Create transfer entry
      const entry: TransferEntry = {
        id: crypto.randomUUID(),
        groupId: group.id,
        type: 'transfer',
        version: 1,
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
        defaultCurrencyAmount: data.amount,
        exchangeRate: data.currency === group.defaultCurrency ? 1 : undefined,
      }

      // Get group key
      const keyString = await db.getGroupKey(group.id, group.currentKeyVersion)
      if (!keyString) {
        throw new Error('Group key not found')
      }
      const groupKey = await importSymmetricKey(keyString)

      // Add to Loro
      await store.createEntry(entry, groupKey, currentIdentity.publicKeyHash)

      // Get the Loro update to push to server
      const manager = syncManager()
      if (manager && autoSyncEnabled()) {
        try {
          // Export incremental update
          const version = store.getVersion()
          const updateBytes = store.exportFrom(version)

          // Push to server
          await manager.pushUpdate(group.id, currentIdentity.publicKeyHash, updateBytes, version)

          // Update sync state
          setSyncState(manager.getState())

          console.log('[AppContext] Transfer synced to server')
        } catch (syncError) {
          console.warn('[AppContext] Failed to sync transfer, queued for later:', syncError)
        }
      }

      // Save snapshot
      await db.saveLoroSnapshot(group.id, store.exportSnapshot())

      // Refresh UI
      await refreshEntries(group.id, group.currentKeyVersion)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add transfer')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  // Manual sync - force sync now
  const manualSync = async () => {
    const manager = syncManager()
    const group = activeGroup()
    const currentIdentity = identity()

    if (!manager || !group || !currentIdentity) {
      console.warn('[AppContext] Cannot sync: missing manager, group, or identity')
      return
    }

    try {
      setIsLoading(true)
      console.log('[AppContext] Manual sync started')

      // Perform incremental sync
      await manager.incrementalSync(group.id, currentIdentity.publicKeyHash)

      // Refresh entries
      await refreshEntries(group.id, group.currentKeyVersion)

      // Update sync state
      setSyncState(manager.getState())

      console.log('[AppContext] Manual sync completed')
    } catch (err) {
      console.error('[AppContext] Manual sync failed:', err)
      setError(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Toggle auto-sync on/off
  const toggleAutoSync = () => {
    setAutoSyncEnabled(!autoSyncEnabled())
    console.log('[AppContext] Auto-sync:', autoSyncEnabled() ? 'enabled' : 'disabled')
  }

  const clearError = () => setError(null)

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
    addExpense,
    addTransfer,
    balances,
    settlementPlan,
    syncState,
    manualSync,
    toggleAutoSync,
    isLoading,
    error,
    clearError,
  }

  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>
}

// Hook to use context
export const useAppContext = () => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider')
  }
  return context
}
