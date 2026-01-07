import { Component, createSignal, Match, Switch } from 'solid-js'
import { useAppContext } from '../context/AppContext'
import { BalanceTab } from '../components/balance/BalanceTab'
import { EntriesTab } from '../components/entries/EntriesTab'
import { MembersTab } from '../components/members/MembersTab'
import { AddEntryModal } from '../components/forms/AddEntryModal'

type TabType = 'balance' | 'entries' | 'members'

export const GroupViewScreen: Component = () => {
  const { activeGroup, deselectGroup, identity, balances, addExpense, addTransfer } = useAppContext()
  const [activeTab, setActiveTab] = createSignal<TabType>('balance')
  const [showAddEntry, setShowAddEntry] = createSignal(false)

  const handleBack = () => {
    deselectGroup()
  }

  const formatCurrency = (amount: number, currency: string): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  const myBalance = () => {
    const userIdentity = identity()
    if (!userIdentity) return null
    return balances().get(userIdentity.publicKeyHash)
  }

  const getBalanceText = (): string => {
    const balance = myBalance()
    if (!balance) return 'No transactions yet'

    const amount = balance.netBalance
    if (Math.abs(amount) < 0.01) {
      return 'All settled up ✓'
    }

    const currency = activeGroup()?.defaultCurrency || 'USD'
    if (amount > 0) {
      return `You're owed ${formatCurrency(amount, currency)}`
    } else {
      return `You owe ${formatCurrency(Math.abs(amount), currency)}`
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
            <button class="back-button" onClick={handleBack} aria-label="Back to groups">
              ←
            </button>
            <div class="group-info">
              <h1 class="group-name">{activeGroup()?.name}</h1>
              <p class={`balance-summary ${getBalanceColor()}`}>
                {getBalanceText()}
              </p>
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
              Balance
            </button>
            <button
              class={`tab ${activeTab() === 'entries' ? 'active' : ''}`}
              onClick={() => setActiveTab('entries')}
            >
              Entries
            </button>
            <button
              class={`tab ${activeTab() === 'members' ? 'active' : ''}`}
              onClick={() => setActiveTab('members')}
            >
              Members
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      <div class="tab-content">
        <div class="container">
          <Switch>
            <Match when={activeTab() === 'balance'}>
              <BalanceTab />
            </Match>
            <Match when={activeTab() === 'entries'}>
              <EntriesTab />
            </Match>
            <Match when={activeTab() === 'members'}>
              <MembersTab />
            </Match>
          </Switch>
        </div>
      </div>

      {/* Floating Add Button */}
      <button
        class="fab"
        onClick={() => setShowAddEntry(true)}
        aria-label="Add entry"
      >
        +
      </button>

      {/* Add Entry Modal */}
      <AddEntryModal
        isOpen={showAddEntry()}
        onClose={() => setShowAddEntry(false)}
        onAddExpense={addExpense}
        onAddTransfer={addTransfer}
      />
    </div>
  )
}
