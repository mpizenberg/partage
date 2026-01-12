import { Component, Show } from 'solid-js'
import { useI18n, formatCurrency } from '../../../i18n'
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
  const { t, locale } = useI18n()

  const isSettled = (): boolean => {
    return Math.abs(props.balance.netBalance) < 0.01
  }

  const getBalanceClass = (): string => {
    if (isSettled()) return 'balance-neutral'
    return props.balance.netBalance > 0 ? 'balance-positive' : 'balance-negative'
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
      <div class="balance-card-row">
        <div class="balance-card-member">
          <span class="balance-card-name">{props.memberName}</span>
          <Show when={props.isCurrentUser}>
            <span class="member-badge">{t('common.you')}</span>
          </Show>
        </div>

        <div class="balance-card-amount">
          <span class={`balance-net ${getBalanceClass()}`}>
            {getBalanceSign()}{formatCurrency(Math.abs(props.balance.netBalance), props.currency, locale())}
          </span>
        </div>

        {/* Pay button for members who are owed money */}
        <Show when={showPayButton()}>
          <div class="balance-card-actions">
            <Button variant="primary" size="small" onClick={handlePayClick}>
              {t('balance.payThem')}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  )
}
