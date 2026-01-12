import { Component, Show, createSignal } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { Modal } from '../common/Modal'
import { Button } from '../common/Button'
import type { Entry, ExpenseEntry, TransferEntry, ExpenseCategory } from '@partage/shared'

// Category emoji mapping
const CATEGORY_EMOJI: Record<ExpenseCategory, string> = {
  food: '🍔',
  transport: '🚗',
  accommodation: '🏨',
  entertainment: '🎬',
  shopping: '🛍️',
  groceries: '🛒',
  utilities: '💡',
  healthcare: '⚕️',
  other: '📝',
}

export interface EntryCardProps {
  entry: Entry
}

export const EntryCard: Component<EntryCardProps> = (props) => {
  const { members, identity, setEditingEntry, deleteEntry, undeleteEntry, loroStore } = useAppContext()
  const [showDeleteModal, setShowDeleteModal] = createSignal(false)
  const [isDeleting, setIsDeleting] = createSignal(false)
  const [isUndeleting, setIsUndeleting] = createSignal(false)

  const isDeleted = () => props.entry.status === 'deleted'

  const handleClick = () => {
    // Don't allow editing deleted entries
    if (!isDeleted()) {
      setEditingEntry(props.entry)
    }
  }

  const handleDeleteClick = (e: MouseEvent) => {
    e.stopPropagation()
    setShowDeleteModal(true)
  }

  const handleConfirmDelete = async () => {
    try {
      setIsDeleting(true)
      await deleteEntry(props.entry.id)
      setShowDeleteModal(false)
    } catch (err) {
      console.error('Failed to delete entry:', err)
    } finally {
      setIsDeleting(false)
    }
  }

  const handleUndeleteClick = async (e: MouseEvent) => {
    e.stopPropagation()
    try {
      setIsUndeleting(true)
      await undeleteEntry(props.entry.id)
    } catch (err) {
      console.error('Failed to undelete entry:', err)
    } finally {
      setIsUndeleting(false)
    }
  }

  const formatCurrency = (amount: number, currency: string): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
    }).format(amount)
  }

  const formatRelativeTime = (timestamp: number): string | null => {
    const now = Date.now()
    const diff = now - timestamp
    const hours = Math.floor(diff / (1000 * 60 * 60))

    // Only show time if created within last 24 hours
    if (hours >= 24) {
      return null
    }

    const minutes = Math.floor(diff / (1000 * 60))

    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`
    } else {
      return 'Just now'
    }
  }

  const shouldShowTime = (timestamp: number): boolean => {
    const now = Date.now()
    const diff = now - timestamp
    const hours = Math.floor(diff / (1000 * 60 * 60))
    return hours < 24
  }

  const getMemberName = (memberId: string): string => {
    const userId = identity()?.publicKeyHash
    if (!userId) return 'Unknown'

    // Check if this is the current user (considering aliases)
    if (memberId === userId) return 'You'
    const store = loroStore()
    if (store) {
      const canonicalUserId = store.resolveCanonicalMemberId(userId)
      if (memberId === canonicalUserId) return 'You'

      // Check if this is a canonical ID (old virtual member) that has been claimed
      const aliases = store.getMemberAliases()
      const alias = aliases.find(a => a.existingMemberId === memberId)
      if (alias) {
        // This is a claimed virtual member - show the NEW member's name
        const newMember = members().find(m => m.id === alias.newMemberId)
        if (newMember) return newMember.name

        // Fallback to full Loro member list
        const allMembers = store.getMembers()
        const newMemberFull = allMembers.find(m => m.id === alias.newMemberId)
        if (newMemberFull) return newMemberFull.name
      }
    }

    // Try filtered members list first
    let member = members().find(m => m.id === memberId)

    // If not found, check full Loro member list (includes replaced virtual members)
    if (!member && store) {
      const allMembers = store.getMembers()
      member = allMembers.find(m => m.id === memberId)
    }

    return member?.name || 'Unknown'
  }

  const isExpense = (): boolean => props.entry.type === 'expense'
  const isTransfer = (): boolean => props.entry.type === 'transfer'

  const expenseEntry = () => (isExpense() ? (props.entry as ExpenseEntry) : null)
  const transferEntry = () => (isTransfer() ? (props.entry as TransferEntry) : null)

  const getCategoryEmoji = (): string => {
    const expense = expenseEntry()
    if (!expense || !expense.category) return '📝'
    return CATEGORY_EMOJI[expense.category as ExpenseCategory] || '📝'
  }

  const getPayersText = (): string => {
    const expense = expenseEntry()
    if (!expense) return ''

    const payerNames = expense.payers.map(p => getMemberName(p.memberId))
    if (payerNames.length === 1) return payerNames[0]!
    if (payerNames.length === 2) return payerNames.join(' and ')
    return `${payerNames[0]!} and ${payerNames.length - 1} other${payerNames.length > 2 ? 's' : ''}`
  }

  const getBeneficiariesText = (): string => {
    const expense = expenseEntry()
    if (!expense) return ''

    const beneficiaryNames = expense.beneficiaries.map(b => getMemberName(b.memberId))
    if (beneficiaryNames.length === 1) return beneficiaryNames[0]!
    if (beneficiaryNames.length === 2) return beneficiaryNames.join(' and ')
    if (beneficiaryNames.length === 3) return beneficiaryNames.join(', ')
    return `${beneficiaryNames.slice(0, 2).join(', ')} and ${beneficiaryNames.length - 2} more`
  }

  const getUserShare = (): number | null => {
    const expense = expenseEntry()
    if (!expense) return null

    const userId = identity()?.publicKeyHash
    if (!userId) return null

    const beneficiary = expense.beneficiaries.find(b => b.memberId === userId)
    if (!beneficiary) return null

    if (beneficiary.splitType === 'exact' && beneficiary.amount !== undefined) {
      return beneficiary.amount
    }

    if (beneficiary.splitType === 'shares' && beneficiary.shares !== undefined) {
      const totalShares = expense.beneficiaries.reduce((sum, b) => sum + (b.shares || 0), 0)
      return (expense.amount * beneficiary.shares) / totalShares
    }

    return null
  }

  const isUserInvolved = (): boolean => {
    const userId = identity()?.publicKeyHash
    if (!userId) return false

    // Get canonical user ID (if user claimed a virtual member)
    const store = loroStore()
    const canonicalUserId = store ? store.resolveCanonicalMemberId(userId) : userId

    if (isExpense()) {
      const expense = expenseEntry()!
      return (
        expense.payers.some(p => p.memberId === userId || p.memberId === canonicalUserId) ||
        expense.beneficiaries.some(b => b.memberId === userId || b.memberId === canonicalUserId)
      )
    }

    if (isTransfer()) {
      const transfer = transferEntry()!
      return (
        transfer.from === userId || transfer.from === canonicalUserId ||
        transfer.to === userId || transfer.to === canonicalUserId
      )
    }

    return false
  }

  return (
    <>
      <div
        class={`entry-card card ${isUserInvolved() ? 'entry-card-involved' : ''} ${isDeleted() ? 'entry-card-deleted' : ''}`}
        onClick={handleClick}
        style={{ cursor: isDeleted() ? 'default' : 'pointer' }}
      >
        {/* Expense Entry */}
        <Show when={isExpense()}>
          <div class="entry-header">
            <div class="entry-icon">{getCategoryEmoji()}</div>
            <div class="entry-main">
              <h3 class="entry-description">{expenseEntry()!.description}</h3>
              <div class="entry-amount">
                {formatCurrency(props.entry.amount, props.entry.currency!)}
                <Show when={expenseEntry()?.category}>
                  <span class="entry-category"> • {expenseEntry()?.category}</span>
                </Show>
              </div>
            </div>
            <Show
              when={!isDeleted()}
              fallback={
                <button
                  class="entry-undelete-btn"
                  onClick={handleUndeleteClick}
                  aria-label="Restore entry"
                  title="Restore entry"
                  disabled={isUndeleting()}
                >
                  {isUndeleting() ? '⏳' : '↶'}
                </button>
              }
            >
              <button
                class="entry-delete-btn"
                onClick={handleDeleteClick}
                aria-label="Delete entry"
                title="Delete entry"
              >
                🗑️
              </button>
            </Show>
          </div>

          <div class="entry-details">
            <div class="entry-detail-row">
              <span class="entry-detail-label">Paid by:</span>
              <span class="entry-detail-value">{getPayersText()}</span>
            </div>
            <div class="entry-detail-row">
              <span class="entry-detail-label">Split:</span>
              <span class="entry-detail-value">{getBeneficiariesText()}</span>
            </div>
            <Show when={getUserShare() !== null}>
              <div class="entry-detail-row entry-user-share">
                <span class="entry-detail-label">Your share:</span>
                <span class="entry-detail-value">
                  {formatCurrency(getUserShare()!, props.entry.currency!)}
                </span>
              </div>
            </Show>
          </div>

          <Show when={shouldShowTime(props.entry.createdAt)}>
            <div class="entry-footer">
              <span class="entry-time">{formatRelativeTime(props.entry.createdAt)}</span>
            </div>
          </Show>
        </Show>

        {/* Transfer Entry */}
        <Show when={isTransfer()}>
          <div class="entry-transfer-row">
            <div class="entry-icon">💸</div>
            <div class="entry-transfer-info">
              <div class="entry-transfer-flow">
                <span class="transfer-amount">{formatCurrency(props.entry.amount, props.entry.currency!)}</span>
                <span class="transfer-members">
                  <span class="transfer-from">{getMemberName(transferEntry()!.from)}</span>
                  <span class="transfer-arrow">→</span>
                  <span class="transfer-to">{getMemberName(transferEntry()!.to)}</span>
                </span>
              </div>
              <Show when={shouldShowTime(props.entry.createdAt)}>
                <span class="entry-time">{formatRelativeTime(props.entry.createdAt)}</span>
              </Show>
            </div>
            <Show
              when={!isDeleted()}
              fallback={
                <button
                  class="entry-undelete-btn"
                  onClick={handleUndeleteClick}
                  aria-label="Restore entry"
                  title="Restore entry"
                  disabled={isUndeleting()}
                >
                  {isUndeleting() ? '⏳' : '↶'}
                </button>
              }
            >
              <button
                class="entry-delete-btn"
                onClick={handleDeleteClick}
                aria-label="Delete entry"
                title="Delete entry"
              >
                🗑️
              </button>
            </Show>
          </div>
        </Show>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal()}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Entry"
      >
        <div style={{ padding: '1rem' }}>
          <p style={{ 'margin-bottom': '1.5rem' }}>
            Are you sure you want to delete this entry? This action can be undone later.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', 'justify-content': 'flex-end' }}>
            <Button
              variant="secondary"
              onClick={() => setShowDeleteModal(false)}
              disabled={isDeleting()}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleConfirmDelete}
              disabled={isDeleting()}
            >
              {isDeleting() ? 'Deleting...' : 'Delete'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
