import {
  createContext,
  useContext,
  Component,
  JSX,
  createSignal,
  onMount,
  Accessor,
  createMemo,
} from 'solid-js'
import { PartageDB, getDB } from '../../core/storage/indexeddb'
import { LoroEntryStore } from '../../core/crdt/loro-wrapper'
import { calculateBalances, generateSettlementPlan } from '../../domain/calculations/balance-calculator'
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

  // UI state
  isLoading: Accessor<boolean>
  error: Accessor<string | null>
  clearError: () => void
}

// Create context
const AppContext = createContext<AppContextValue>()

// Provider component
export const AppProvider: Component<{ children: JSX.Element }> = (props) => {
  const db = getDB()

  // Core state
  const [identity, setIdentity] = createSignal<SerializedKeypair | null>(null)
  const [groups, setGroups] = createSignal<Group[]>([])
  const [activeGroup, setActiveGroup] = createSignal<Group | null>(null)
  const [loroStore, setLoroStore] = createSignal<LoroEntryStore | null>(null)

  // Derived state
  const [entries, setEntries] = createSignal<Entry[]>([])
  const [balances, setBalances] = createSignal<Map<string, Balance>>(new Map())

  // UI state
  const [isLoading, setIsLoading] = createSignal(true)
  const [error, setError] = createSignal<string | null>(null)

  // Members for active group (all members: real + virtual)
  const members = createMemo(() => {
    const group = activeGroup()
    if (!group) return []
    return group.members || []
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
    try {
      setIsLoading(true)

      // Open database
      await db.open()

      // Load user identity
      const storedIdentity = await db.getUserKeypair()
      setIdentity(storedIdentity?.keypair || null)

      // Load all groups
      const allGroups = await db.getAllGroups()
      setGroups(allGroups)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize app')
      console.error('Initialization error:', err)
    } finally {
      setIsLoading(false)
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
    try {
      setIsLoading(true)
      setError(null)

      const currentIdentity = identity()
      if (!currentIdentity) {
        throw new Error('No identity found. Please initialize identity first.')
      }

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
      await db.saveGroup(group)
      await db.saveGroupKey(groupId, 1, exportedKey)

      // Initialize Loro store with empty snapshot
      const newLoroStore = new LoroEntryStore()
      await db.saveLoroSnapshot(groupId, newLoroStore.exportSnapshot())

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

      // Get group from database
      const group = await db.getGroup(groupId)
      if (!group) {
        throw new Error('Group not found')
      }

      // Load Loro snapshot
      const snapshot = await db.getLoroSnapshot(groupId)
      const store = new LoroEntryStore()

      if (snapshot) {
        store.importSnapshot(snapshot)
      }

      setLoroStore(store)
      setActiveGroup(group)

      // Load entries and calculate balances
      await refreshEntries(groupId, group.currentKeyVersion)

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load group')
      throw err
    } finally {
      setIsLoading(false)
    }
  }

  // Deselect active group
  const deselectGroup = () => {
    setActiveGroup(null)
    setLoroStore(null)
    setEntries([])
    setBalances(new Map())
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

  const clearError = () => setError(null)

  const value: AppContextValue = {
    db,
    loroStore,
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
