import { Component, createSignal, Match, Switch } from 'solid-js'
import { useI18n, formatCurrency } from '../../i18n'
import { useAppContext } from '../context/AppContext'
import { BalanceTab } from '../components/balance/BalanceTab'
import { EntriesTab } from '../components/entries/EntriesTab'
import { MembersTab } from '../components/members/MembersTab'
import { ActivitiesTab } from '../components/activities/ActivitiesTab'
import { SettleTab } from '../components/settle/SettleTab'
import { AddEntryModal, type TransferInitialData } from '../components/forms/AddEntryModal'
import { LanguageSwitcher } from '../components/common/LanguageSwitcher'

type TabType = 'balance' | 'entries' | 'settle' | 'members' | 'activities'

export const GroupViewScreen: Component = () => {
  const { t, locale } = useI18n()
  const {
    activeGroup,
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
  } = useAppContext()
  const [activeTab, setActiveTab] = createSignal<TabType>('balance')
  const [showAddEntry, setShowAddEntry] = createSignal(false)
  const [transferInitialData, setTransferInitialData] = createSignal<TransferInitialData | null>(null)

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

      {/* Tab Content */}
      <div class="tab-content">
        <div class="container">
          <Switch>
            <Match when={activeTab() === 'balance'}>
              <BalanceTab onPayMember={handlePayMember} />
            </Match>
            <Match when={activeTab() === 'entries'}>
              <EntriesTab onAddEntry={() => setShowAddEntry(true)} />
            </Match>
            <Match when={activeTab() === 'settle'}>
              <SettleTab />
            </Match>
            <Match when={activeTab() === 'members'}>
              <MembersTab />
            </Match>
            <Match when={activeTab() === 'activities'}>
              <ActivitiesTab />
            </Match>
          </Switch>
        </div>
      </div>

      {/* Floating Add Button */}
      <button
        class="fab"
        onClick={() => setShowAddEntry(true)}
        aria-label={t('entries.addEntry')}
      >
        +
      </button>

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
