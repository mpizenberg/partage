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
  JoinRequest,
} from '@partage/shared'
import { createJoinRequest as createJoinRequestUtil } from '../../domain/invitations/invite-manager'
import { processJoinRequest as processJoinRequestUtil } from '../../domain/invitations/invite-manager'
import { buildGroupKeysPayload, importGroupKeys } from '../../domain/invitations/key-sharing'
import { importKeypair } from '../../core/crypto/keypair'
import { importSigningKeypair } from '../../core/crypto/signatures'
import { verifyAndDecryptKeyPackage } from '../../core/crypto/key-exchange'

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

  // Invitations & Multi-User (Phase 5)
  createInvitation: (groupId: string, groupName: string) => Promise<{ inviteLink: string }>
  submitJoinRequest: (invitationId: string, groupId: string, userName: string) => Promise<void>
  pendingJoinRequests: Accessor<any[]> // JoinRequest[] from @partage/shared
  approveJoinRequest: (requestId: string) => Promise<void>

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

  // Phase 5: Invitations & Multi-User
  const [pendingJoinRequests, setPendingJoinRequests] = createSignal<JoinRequest[]>([])

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

      // Create group on server first to get server-generated ID
      let groupId: string
      const createdAt = Date.now()

      if (navigator.onLine) {
        try {
          console.log('[AppContext] Creating group on server...')
          const serverGroup = await pbClient.createGroup({
            name,
            createdAt,
            createdBy: currentIdentity.publicKeyHash,
            lastActivityAt: createdAt,
            memberCount: virtualMembers.length + 1,
          })
          groupId = serverGroup.id
          console.log('[AppContext] Group created on server with ID:', groupId)
        } catch (error) {
          console.error('[AppContext] Failed to create group on server:', error)
          throw new Error('Failed to create group on server. Please check your connection.')
        }
      } else {
        // Offline: use UUID (will need special handling for sync later)
        groupId = crypto.randomUUID()
        console.log('[AppContext] Offline: using local UUID:', groupId)
      }

      // Generate group key
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
      }

      // Initialize Loro store and add initial members
      const newLoroStore = new LoroEntryStore()

      // Add creator as first member
      newLoroStore.addMember({
        id: currentIdentity.publicKeyHash,
        name: 'You',
        publicKey: currentIdentity.publicKey,
        joinedAt: Date.now(),
        status: 'active',
        isVirtual: false,
      })

      // Add virtual members to Loro
      for (const member of virtualMembers) {
        newLoroStore.addMember(member)
      }

      // Save to database
      console.log('[AppContext] Saving group locally with ID:', groupId)
      console.log('[AppContext] Group members:', group.members)
      await db.saveGroup(group)
      await db.saveGroupKey(groupId, 1, exportedKey)
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

      // Sync members from Loro to group object
      const members = store.getMembers()
      const updatedGroup = { ...group, members }
      if (members.length > 0) {
        await db.saveGroup(updatedGroup)
      }

      setLoroStore(store)
      setActiveGroup(updatedGroup)
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

          // Sync members from Loro after sync (in case new members were added)
          const syncedMembers = store.getMembers()
          const syncedGroup = { ...updatedGroup, members: syncedMembers }
          if (syncedMembers.length > 0) {
            await db.saveGroup(syncedGroup)
            setActiveGroup(syncedGroup)
          }

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

      // Fetch and subscribe to join requests (for existing members)
      if (navigator.onLine) {
        try {
          // Fetch existing pending join requests
          try {
            const existingRequests = await pbClient.listJoinRequests(groupId, { status: 'pending' })
            const typedRequests: JoinRequest[] = existingRequests.map(req => ({
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
            }))
            setPendingJoinRequests(typedRequests)
            console.log('[AppContext] Loaded pending join requests:', typedRequests.length)
          } catch (fetchErr) {
            // Collection might not exist yet or no records - that's ok
            console.log('[AppContext] Could not fetch join requests (collection may not exist):', fetchErr)
            setPendingJoinRequests([])
          }

          // Subscribe to new join requests
          try {
            await pbClient.subscribeToJoinRequests(groupId, (joinRequest) => {
              console.log('[AppContext] New join request received:', joinRequest)
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
              }
              setPendingJoinRequests(prev => [...prev, typedRequest])
            })
          } catch (subscribeErr) {
            console.log('[AppContext] Could not subscribe to join requests:', subscribeErr)
          }
        } catch (err) {
          console.warn('[AppContext] Failed to setup join requests:', err)
        }
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

    // Clear pending join requests
    setPendingJoinRequests([])

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

  // Phase 5: Create invitation for a group
  const createInvitation = async (groupId: string, groupName: string) => {
    try {
      const currentIdentity = identity()
      if (!currentIdentity) {
        throw new Error('No identity found')
      }

      // Get signing keypair from storage
      const storedKeypairs = await db.getUserKeypair()
      if (!storedKeypairs?.signingKeypair) {
        throw new Error('Signing keypair not found')
      }

      // Save invitation to server first to get PocketBase-generated ID
      if (!navigator.onLine) {
        throw new Error('Must be online to create invitations')
      }

      const invitationRecord = await pbClient.createInvitation({
        groupId: groupId,
        inviterPublicKeyHash: currentIdentity.publicKeyHash,
        createdAt: Date.now(),
        usedCount: 0,
        status: 'active',
      })

      // Create invite link using the PocketBase-generated ID
      const linkData = {
        invitationId: invitationRecord.id,
        groupId,
        groupName,
      }
      const linkDataJSON = JSON.stringify(linkData)
      const linkDataBase64 = btoa(linkDataJSON)
      const inviteLink = `${window.location.origin}/join/${linkDataBase64}`

      return { inviteLink }
    } catch (err) {
      console.error('Failed to create invitation:', err)
      throw err
    }
  }

  // Phase 5: Submit join request (for new users)
  const submitJoinRequest = async (invitationId: string, groupId: string, userName: string) => {
    try {
      const currentIdentity = identity()
      if (!currentIdentity) {
        throw new Error('No identity found')
      }

      const userKeypair = await importKeypair(currentIdentity)

      const joinRequest = await createJoinRequestUtil(
        invitationId,
        groupId,
        userKeypair,
        userName
      )

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
        })

        console.log('Join request created with ID:', createdRequest.id)

        // Subscribe to key packages for this user
        await pbClient.subscribeToKeyPackages(
          currentIdentity.publicKeyHash,
          async (keyPackage) => {
            console.log('Received key package:', keyPackage)
            // Process the key package
            await processReceivedKeyPackage(keyPackage)
          }
        )
      }
    } catch (err) {
      console.error('Failed to submit join request:', err)
      throw err
    }
  }

  // Phase 5: Process received key package
  const processReceivedKeyPackage = async (keyPackageRecord: any) => {
    try {
      const currentIdentity = identity()
      const storedKeypairs = await db.getUserKeypair()

      if (!currentIdentity || !storedKeypairs?.signingKeypair) {
        throw new Error('Missing identity or signing keypair')
      }

      const userKeypair = await importKeypair(currentIdentity)

      // Use sender's public keys for decryption and verification
      const senderPublicKey = keyPackageRecord.senderPublicKey
      const senderSigningKey = keyPackageRecord.senderSigningPublicKey

      // Verify and decrypt
      const payload = await verifyAndDecryptKeyPackage(
        keyPackageRecord.encryptedKeys,
        keyPackageRecord.signature,
        senderPublicKey, // Sender's ECDH public key for decryption
        senderSigningKey, // Sender's signing public key for verification
        userKeypair.privateKey
      )

      // Import group keys
      await importGroupKeys(payload)

      // Fetch group metadata and join request
      const groupRecord = await pbClient.getGroup(payload.groupId)
      const joinRequest = await pbClient.getJoinRequest(keyPackageRecord.joinRequestId)

      // Initialize or load Loro CRDT for this group
      const loroStore = new LoroEntryStore()
      const existingSnapshot = await db.getLoroSnapshot(payload.groupId)
      if (existingSnapshot) {
        loroStore.importSnapshot(existingSnapshot)
      }

      // Add new member to Loro CRDT
      const newMember: Member = {
        id: currentIdentity.publicKeyHash,
        name: joinRequest.requesterName,
        publicKey: joinRequest.requesterPublicKey,
        joinedAt: Date.now(),
        status: 'active',
        isVirtual: false,
      }
      loroStore.addMember(newMember)

      // Get all members from Loro
      const members = loroStore.getMembers()

      // Save updated Loro snapshot
      const snapshot = loroStore.exportSnapshot()
      await db.saveLoroSnapshot(payload.groupId, snapshot)

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
        members,
      }

      // Save group to local storage
      await db.saveGroup(group)
      console.log('Successfully joined group:', group.name)

      // Initialize sync manager for this group and do initial sync
      const manager = new SyncManager({
        loroStore,
        storage: db,
        apiClient: pbClient,
        enableAutoSync: true,
      })
      await manager.initialSync(group.id, currentIdentity.publicKeyHash)
      await manager.subscribeToGroup(group.id, currentIdentity.publicKeyHash)

      // Refresh groups list
      const allGroups = await db.getAllGroups()
      setGroups(allGroups)

      // Navigate to the new group
      window.location.href = '/'
    } catch (err) {
      console.error('Failed to process key package:', err)
      throw err
    }
  }

  // Phase 5: Approve join request (for existing members)
  const approveJoinRequest = async (requestId: string) => {
    try {
      const currentIdentity = identity()
      const storedKeypairs = await db.getUserKeypair()
      const group = activeGroup()

      if (!currentIdentity || !storedKeypairs?.signingKeypair || !group) {
        throw new Error('Missing identity, signing keypair, or active group')
      }

      // Get the join request
      const joinRequest = await pbClient.getJoinRequest(requestId)

      // Import keypairs
      const userKeypair = await importKeypair(currentIdentity)
      const signingKeypair = await importSigningKeypair(storedKeypairs.signingKeypair)

      // Build group keys payload
      const keysPayload = await buildGroupKeysPayload(
        group.id,
        group.currentKeyVersion,
        currentIdentity.publicKeyHash
      )

      // Convert JoinRequestRecord to JoinRequest type
      const joinRequestTyped: JoinRequest = {
        ...joinRequest,
        status: joinRequest.status as 'pending' | 'approved' | 'rejected',
      }

      // Process join request (creates encrypted key package)
      const keyPackage = await processJoinRequestUtil(
        joinRequestTyped,
        keysPayload,
        userKeypair,
        signingKeypair
      )

      // Send key package to server
      if (navigator.onLine) {
        const keyPackageData = {
          joinRequestId: keyPackage.joinRequestId,
          groupId: keyPackage.groupId,
          recipientPublicKeyHash: keyPackage.recipientPublicKeyHash,
          senderPublicKeyHash: keyPackage.senderPublicKeyHash,
          senderPublicKey: keyPackage.senderPublicKey,
          senderSigningPublicKey: keyPackage.senderSigningPublicKey,
          encryptedKeys: keyPackage.encryptedKeys,
          createdAt: keyPackage.createdAt,
          signature: keyPackage.signature,
        };
        console.log('[AppContext] Creating key package with data:', keyPackageData);
        const createdPackage = await pbClient.createKeyPackage(keyPackageData)

        console.log('Key package created with ID:', createdPackage.id)

        // Update join request status
        await pbClient.updateJoinRequest(requestId, {
          status: 'approved',
          approvedBy: currentIdentity.publicKeyHash,
          approvedAt: Date.now(),
        })

        // Remove from pending list
        setPendingJoinRequests((prev) => prev.filter((req) => req.id !== requestId))

        // Add new member to Loro CRDT
        const store = loroStore()
        const manager = syncManager()
        if (store) {
          const newMember: Member = {
            id: joinRequest.requesterPublicKeyHash,
            name: joinRequest.requesterName,
            publicKey: joinRequest.requesterPublicKey,
            joinedAt: Date.now(),
            status: 'active',
            isVirtual: false,
          }
          store.addMember(newMember)

          // Sync the member update to server
          if (manager) {
            await manager.incrementalSync(group.id, currentIdentity.publicKeyHash)
          }

          // Update local group members list
          const updatedMembers = store.getMembers()
          const updatedGroup = { ...group, members: updatedMembers }
          await db.saveGroup(updatedGroup)
          setActiveGroup(updatedGroup)

          console.log('Added new member to group:', newMember.name)
        }

        // TODO: Rotate group key for security
      }
    } catch (err) {
      console.error('Failed to approve join request:', err)
      throw err
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
