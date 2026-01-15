import { Component, createSignal, createEffect, createMemo, Match, Switch, Show } from 'solid-js'
import { useNavigate, useParams } from '@solidjs/router'
import { useI18n, formatCurrency } from '../../i18n'
import { useAppContext } from '../context/AppContext'
import { BalanceTab } from '../components/balance/BalanceTab'
import { EntriesTab } from '../components/entries/EntriesTab'
import { MembersTab } from '../components/members/MembersTab'
import { ActivitiesTab } from '../components/activities/ActivitiesTab'
import { SettleTab } from '../components/settle/SettleTab'
import { AddEntryModal, type TransferInitialData } from '../components/forms/AddEntryModal'
import { LanguageSwitcher } from '../components/common/LanguageSwitcher'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import { generateInviteLink } from '../../domain/invitations/invite-manager'

type TabType = 'balance' | 'entries' | 'settle' | 'members' | 'activities'

const VALID_TABS: TabType[] = ['balance', 'entries', 'settle', 'members', 'activities']

export const GroupViewScreen: Component = () => {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const params = useParams<{ groupId: string; tab?: string }>()
  const {
    activeGroup,
    selectGroup,
    deselectGroup,
    identity,
    balances,
    addExpense,
    addTransfer,
    modifyExpense,
    modifyTransfer,
    editingEntry,
    setEditingEntry,
    loroStore,
    db,
    isLoading,
  } = useAppContext()
  const [showAddEntry, setShowAddEntry] = createSignal(false)
  const [transferInitialData, setTransferInitialData] = createSignal<TransferInitialData | null>(null)
  const [showBannerDetails, setShowBannerDetails] = createSignal(false)
  const [groupLoading, setGroupLoading] = createSignal(false)

  // Get active tab from URL params, default to 'balance'
  const activeTab = createMemo<TabType>(() => {
    const tabParam = params.tab?.toLowerCase()
    if (tabParam && VALID_TABS.includes(tabParam as TabType)) {
      return tabParam as TabType
    }
    return 'balance'
  })

  // Set tab by navigating to the URL
  const setActiveTab = (tab: TabType) => {
    const groupId = params.groupId
    if (tab === 'balance') {
      // Default tab doesn't need to be in URL
      navigate(`/groups/${groupId}`)
    } else {
      navigate(`/groups/${groupId}/${tab}`)
    }
  }

  // Load group on mount based on URL params
  createEffect(() => {
    const groupId = params.groupId
    const currentGroup = activeGroup()

    // If the group from URL doesn't match the active group, load it
    if (groupId && (!currentGroup || currentGroup.id !== groupId)) {
      setGroupLoading(true)
      selectGroup(groupId)
        .catch((err) => {
          console.error('[GroupViewScreen] Failed to load group:', err)
          // Redirect to home if group not found
          navigate('/')
        })
        .finally(() => setGroupLoading(false))
    }
  })

  // Modal is open when adding new entry OR editing existing entry OR quick settlement
  const isModalOpen = () => showAddEntry() || editingEntry() !== null || transferInitialData() !== null

  // Close modal and clear all states
  const handleModalClose = () => {
    setShowAddEntry(false)
    setEditingEntry(null)
    setTransferInitialData(null)
  }

  // Handle "Pay [member]" button click from BalanceCard
  const handlePayMember = (memberId: string, _memberName: string, amount: number) => {
    const currentUserId = identity()?.publicKeyHash
    if (!currentUserId) return

    const currency = activeGroup()?.defaultCurrency || 'USD'

    setTransferInitialData({
      from: currentUserId,
      to: memberId,
      amount: amount,
      currency: currency,
    })
  }

  const handleBack = () => {
    deselectGroup()
    navigate('/')
  }

  const myBalance = () => {
    const userIdentity = identity()
    if (!userIdentity) return null

    // Resolve to canonical ID (if user claimed a virtual member)
    const store = loroStore()
    if (!store) return balances().get(userIdentity.publicKeyHash)

    const canonicalUserId = store.resolveCanonicalMemberId(userIdentity.publicKeyHash)
    return balances().get(canonicalUserId)
  }

  const getBalanceText = (): string => {
    const balance = myBalance()
    if (!balance) return t('balance.noTransactions')

    const amount = balance.netBalance
    if (Math.abs(amount) < 0.01) {
      return t('balance.allSettled') + ' ✓'
    }

    const currency = activeGroup()?.defaultCurrency || 'USD'
    const formattedAmount = formatCurrency(Math.abs(amount), currency, locale())
    if (amount > 0) {
      return t('balance.youAreOwed', { amount: formattedAmount })
    } else {
      return t('balance.youOwe', { amount: formattedAmount })
    }
  }

  const getBalanceColor = (): string => {
    const balance = myBalance()
    if (!balance) return 'text-muted'

    const amount = balance.netBalance
    if (Math.abs(amount) < 0.01) return 'text-muted'
    return amount > 0 ? 'text-success' : 'text-danger'
  }

  // Check if current user is a valid member of the group
  // Optimized to use O(n) with early exit - much faster than computing all member states
  const isUnknownUser = () => {
    const userIdentity = identity()
    if (!userIdentity) return false

    const store = loroStore()
    if (!store) {
      console.error('[GroupViewScreen] Loro store not initialized')
      return false
    }

    // Use isMemberKnown() for efficient check with early exit
    return !store.isMemberKnown(userIdentity.publicKeyHash)
  }

  const handleRejoin = async () => {
    const group = activeGroup()
    if (!group) return

    try {
      // Get the group key from storage
      const groupKeyBase64 = await db.getGroupKey(group.id)
      if (!groupKeyBase64) {
        console.error('Group key not found')
        return
      }

      // Generate the invite link (same as when creating invitations)
      const inviteLink = generateInviteLink(group.id, groupKeyBase64, group.name)

      // Extract the path from the invite link (remove origin)
      // inviteLink format: http://localhost:3000/join/groupId?name=...#key
      // We want: /join/groupId?name=...#key (or just /join/groupId#key)
      const url = new URL(inviteLink)
      const path = url.pathname + url.search + url.hash

      // Navigate to the join page
      navigate(path)
    } catch (error) {
      console.error('Failed to generate rejoin link:', error)
    }
  }

  // Show loading while group is being loaded
  if (groupLoading() || isLoading() || !activeGroup()) {
    return (
      <div class="container flex-center" style="min-height: 100vh;">
        <LoadingSpinner size="large" />
      </div>
    )
  }

  return (
    <div class="group-view-screen">
      {/* Header */}
      <div class="group-header">
        <div class="container">
          <div class="group-header-content">
            <button class="back-button" onClick={handleBack} aria-label={t('common.back')}>
              ←
            </button>
            <div class="group-info">
              <h1 class="group-name">{activeGroup()?.name}</h1>
              <p class={`balance-summary ${getBalanceColor()}`}>
                {getBalanceText()}
              </p>
            </div>
            <div class="group-header-actions">
              <LanguageSwitcher />
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div class="tabs-container">
        <div class="container">
          <div class="tabs">
            <button
              class={`tab ${activeTab() === 'balance' ? 'active' : ''}`}
              onClick={() => setActiveTab('balance')}
            >
              <span class="tab-icon">⚖️</span>
              <span>{t('tabs.balance')}</span>
            </button>
            <button
              class={`tab ${activeTab() === 'entries' ? 'active' : ''}`}
              onClick={() => setActiveTab('entries')}
            >
              <span class="tab-icon">📒</span>
              <span>{t('tabs.entries')}</span>
            </button>
            <button
              class={`tab ${activeTab() === 'settle' ? 'active' : ''}`}
              onClick={() => setActiveTab('settle')}
            >
              <span class="tab-icon">✅</span>
              <span>{t('tabs.settle')}</span>
            </button>
            <button
              class={`tab ${activeTab() === 'members' ? 'active' : ''}`}
              onClick={() => setActiveTab('members')}
            >
              <span class="tab-icon">👥</span>
              <span>{t('tabs.members')}</span>
            </button>
            <button
              class={`tab ${activeTab() === 'activities' ? 'active' : ''}`}
              onClick={() => setActiveTab('activities')}
            >
              <span class="tab-icon">⚡</span>
              <span>{t('tabs.activity')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Unknown User Banner */}
      <Show when={isUnknownUser()}>
        <div class="unknown-user-banner">
          <div class="container">
            <div class="banner-content">
              <span class="banner-icon">⚠️</span>
              <div class="banner-text">
                <span class="banner-message">
                  {t('banner.unknownUser')} <button class="banner-link" onClick={handleRejoin}>[{t('banner.rejoin')}]</button>
                  {' '}
                  <button
                    class="banner-expand"
                    onClick={() => setShowBannerDetails(!showBannerDetails())}
                  >
                    ({showBannerDetails() ? t('banner.hideInfo') : t('banner.showInfo')})
                  </button>
                </span>
                <Show when={showBannerDetails()}>
                  <div class="banner-details">
                    {t('banner.unknownUserDetails')}
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* Tab Content */}
      <div class="tab-content">
        <div class="container">
          <Switch>
            <Match when={activeTab() === 'balance'}>
              <BalanceTab onPayMember={handlePayMember} disabled={isUnknownUser()} />
            </Match>
            <Match when={activeTab() === 'entries'}>
              <EntriesTab onAddEntry={() => setShowAddEntry(true)} disabled={isUnknownUser()} />
            </Match>
            <Match when={activeTab() === 'settle'}>
              <SettleTab disabled={isUnknownUser()} />
            </Match>
            <Match when={activeTab() === 'members'}>
              <MembersTab disabled={isUnknownUser()} />
            </Match>
            <Match when={activeTab() === 'activities'}>
              <ActivitiesTab />
            </Match>
          </Switch>
        </div>
      </div>

      {/* Floating Add Button - hide for unknown users */}
      <Show when={!isUnknownUser()}>
        <button
          class="fab"
          onClick={() => setShowAddEntry(true)}
          aria-label={t('entries.addEntry')}
        >
          +
        </button>
      </Show>

      {/* Add/Edit Entry Modal */}
      <AddEntryModal
        isOpen={isModalOpen()}
        onClose={handleModalClose}
        onAddExpense={addExpense}
        onAddTransfer={addTransfer}
        editEntry={editingEntry()}
        onModifyExpense={modifyExpense}
        onModifyTransfer={modifyTransfer}
        transferInitialData={transferInitialData()}
      />
    </div>
  )
}
