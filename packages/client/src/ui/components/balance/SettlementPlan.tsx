import { Component, Show, For, createSignal } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { Button } from '../common/Button'
import type { SettlementPlan as SettlementPlanType, Member } from '@partage/shared'

export interface SettlementPlanProps {
  plan: SettlementPlanType
  currency: string
  members: Member[]
}

export const SettlementPlan: Component<SettlementPlanProps> = (props) => {
  const { addTransfer, identity } = useAppContext()
  const [isSettling, setIsSettling] = createSignal<string | null>(null)

  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: props.currency,
    }).format(amount)
  }

  const getMemberName = (memberId: string): string => {
    if (memberId === identity()?.publicKeyHash) return 'You'
    const member = props.members.find(m => m.id === memberId)
    return member?.name || 'Unknown'
  }

  const handleSettle = async (fromId: string, toId: string, amount: number) => {
    const settlementKey = `${fromId}-${toId}`
    try {
      setIsSettling(settlementKey)

      await addTransfer({
        amount,
        currency: props.currency,
        from: fromId,
        to: toId,
        date: Date.now(),
        notes: 'Settlement payment',
      })

      // Success - balance will update automatically via context
    } catch (err) {
      console.error('Failed to record settlement:', err)
      // Error is handled by context
    } finally {
      setIsSettling(null)
    }
  }

  const isUserInvolved = (fromId: string, toId: string): boolean => {
    const userId = identity()?.publicKeyHash
    return userId === fromId || userId === toId
  }

  return (
    <Show
      when={props.plan.transactions.length > 0}
      fallback={
        <div class="settlement-empty">
          <div class="text-center p-lg">
            <div class="text-xl mb-sm">✓</div>
            <p class="text-base font-semibold mb-xs">All Settled Up!</p>
            <p class="text-sm text-muted">Everyone's balances are squared away</p>
          </div>
        </div>
      }
    >
      <div class="settlement-plan">
        <div class="settlement-header">
          <h3 class="text-lg font-semibold">Suggested Settlements</h3>
          <p class="text-sm text-muted">
            {props.plan.totalTransactions} payment{props.plan.totalTransactions !== 1 ? 's' : ''} to settle all balances
          </p>
        </div>

        <div class="settlement-list">
          <For each={props.plan.transactions}>
            {(transaction) => {
              const settlementKey = `${transaction.from}-${transaction.to}`
              const loading = isSettling() === settlementKey
              const involved = isUserInvolved(transaction.from, transaction.to)

              return (
                <div class={`settlement-item ${involved ? 'settlement-item-involved' : ''}`}>
                  <div class="settlement-info">
                    <div class="settlement-flow">
                      <span class="settlement-from">{getMemberName(transaction.from)}</span>
                      <span class="settlement-arrow">→</span>
                      <span class="settlement-to">{getMemberName(transaction.to)}</span>
                    </div>
                    <div class="settlement-amount">
                      {formatCurrency(transaction.amount)}
                    </div>
                  </div>

                  <Show when={involved}>
                    <Button
                      variant="primary"
                      size="small"
                      onClick={() => handleSettle(transaction.from, transaction.to, transaction.amount)}
                      disabled={loading}
                    >
                      {loading ? 'Recording...' : 'Mark as Paid'}
                    </Button>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>

        <div class="settlement-note">
          <p class="text-xs text-muted">
            💡 Tip: These settlements minimize the total number of transactions needed
          </p>
        </div>
      </div>
    </Show>
  )
}
