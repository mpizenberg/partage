import { Component, Show } from 'solid-js'
import { Button } from '../common/Button'
import type { Balance } from '@partage/shared'

export interface BalanceCardProps {
  balance: Balance
  memberName: string
  memberId: string
  currency: string
  isCurrentUser?: boolean
  onPayMember?: (memberId: string, memberName: string, amount: number) => void
}

export const BalanceCard: Component<BalanceCardProps> = (props) => {
  const formatCurrency = (amount: number): string => {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: props.currency,
    }).format(amount)
  }

  const isSettled = (): boolean => {
    return Math.abs(props.balance.netBalance) < 0.01
  }

  const getBalanceClass = (): string => {
    if (isSettled()) return 'balance-neutral'
    return props.balance.netBalance > 0 ? 'balance-positive' : 'balance-negative'
  }

  const getBalanceText = (): string => {
    if (isSettled()) return 'Settled up'
    const amount = Math.abs(props.balance.netBalance)
    if (props.balance.netBalance > 0) {
      return `is owed ${formatCurrency(amount)}`
    } else {
      return `owes ${formatCurrency(amount)}`
    }
  }

  const getBalanceSign = (): string => {
    if (isSettled()) return ''
    return props.balance.netBalance > 0 ? '+' : '-'
  }

  // Show "Pay" button for non-current user members with positive balance (owed money)
  const showPayButton = (): boolean => {
    return !props.isCurrentUser && props.balance.netBalance > 0.01 && !!props.onPayMember
  }

  const handlePayClick = () => {
    if (props.onPayMember) {
      props.onPayMember(props.memberId, props.memberName, Math.abs(props.balance.netBalance))
    }
  }

  return (
    <div class={`balance-card card ${props.isCurrentUser ? 'balance-card-current' : ''}`}>
      <div class="balance-card-header">
        <div class="balance-card-member">
          <span class="balance-card-name">{props.memberName}</span>
          <Show when={props.isCurrentUser}>
            <span class="member-badge">You</span>
          </Show>
        </div>
      </div>

      <div class="balance-card-amount">
        <div class={`balance-net ${getBalanceClass()}`}>
          {getBalanceSign()}{formatCurrency(Math.abs(props.balance.netBalance))}
        </div>
        <div class="balance-status text-muted">
          {getBalanceText()}
        </div>
      </div>

      {/* Pay button for members who are owed money */}
      <Show when={showPayButton()}>
        <div class="balance-card-actions">
          <Button variant="primary" onClick={handlePayClick}>
            Pay {props.memberName}
          </Button>
        </div>
      </Show>
    </div>
  )
}
