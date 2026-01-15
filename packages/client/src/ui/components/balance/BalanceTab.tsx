import { Component, Show, For, createMemo } from 'solid-js'
import { useI18n } from '../../../i18n'
import { useAppContext } from '../../context/AppContext'
import { BalanceCard } from './BalanceCard'
import { SettlementPlan } from './SettlementPlan'

export interface BalanceTabProps {
  onPayMember?: (memberId: string, memberName: string, amount: number) => void
  disabled?: boolean
}

export const BalanceTab: Component<BalanceTabProps> = (props) => {
  const { t } = useI18n()
  const { balances, settlementPlan, activeGroup, members, identity, entries, loroStore } = useAppContext()

  // Memoize the canonical user ID to avoid repeated resolution
  const myUserId = createMemo(() => {
    const userId = identity()?.publicKeyHash
    if (!userId) return ''

    // Resolve to canonical ID (if user claimed a virtual member)
    const store = loroStore()
    if (!store) return userId

    return store.resolveCanonicalMemberId(userId)
  })

  // Memoized member name lookup map - O(1) lookups instead of O(n) finds
  // Uses event-based system with canonical ID resolution
  const memberNameMap = createMemo(() => {
    const nameMap = new Map<string, string>()
    const store = loroStore()
    if (!store) {
      // Fallback to basic members list when store not loaded
      for (const member of members()) {
        nameMap.set(member.id, member.name)
      }
      return nameMap
    }

    // Use event-based system: resolve each member to their canonical name
    const canonicalIdMap = store.getCanonicalIdMap()
    const allStates = store.getAllMemberStates()

    for (const [memberId, state] of allStates) {
      // For each member, look up the canonical ID's name
      const canonicalId = canonicalIdMap.get(memberId) ?? memberId
      const canonicalState = allStates.get(canonicalId)
      nameMap.set(memberId, canonicalState?.name ?? state.name)
    }
    return nameMap
  })

  // Check if a member ID represents the current user (using memoized canonical ID)
  const isCurrentUserMember = (memberId: string): boolean => {
    const canonicalUserId = myUserId()
    if (!canonicalUserId) return false
    return memberId === canonicalUserId || memberId === identity()?.publicKeyHash
  }

  // O(1) member name lookup using memoized map
  const getMemberName = (memberId: string): string => {
    return memberNameMap().get(memberId) || t('common.unknown')
  }

  const allBalances = createMemo(() => {
    const canonicalUserId = myUserId()
    if (!canonicalUserId) return []

    // Put current user first, then others sorted alphabetically (case insensitive)
    const userBalance = balances().get(canonicalUserId)
    const otherBalances = Array.from(balances().entries())
      .filter(([memberId]) => memberId !== canonicalUserId)
      .sort((a, b) => {
        const nameA = getMemberName(a[0]).toLowerCase()
        const nameB = getMemberName(b[0]).toLowerCase()
        return nameA.localeCompare(nameB)
      })

    if (userBalance) {
      return [[canonicalUserId, userBalance] as [string, typeof userBalance], ...otherBalances]
    }
    return otherBalances
  })

  const currency = () => activeGroup()?.defaultCurrency || 'USD'

  const hasEntries = () => entries().length > 0

  return (
    <div class="balance-tab">
      <Show
        when={hasEntries()}
        fallback={
          <div class="empty-state">
            <div class="empty-state-icon">💰</div>
            <h2 class="empty-state-title">{t('balance.noBalances')}</h2>
            <p class="empty-state-message">
              {t('balance.noBalancesMessage')}
            </p>
          </div>
        }
      >
        {/* All Balances */}
        <div class="balance-section">
          <div class="balance-list">
            <For each={allBalances()}>
              {([memberId, balance]) => (
                <BalanceCard
                  balance={balance}
                  memberName={getMemberName(memberId)}
                  memberId={memberId}
                  currency={currency()}
                  isCurrentUser={isCurrentUserMember(memberId)}
                  onPayMember={props.disabled ? undefined : props.onPayMember}
                />
              )}
            </For>
          </div>
        </div>

        {/* Settlement Plan */}
        <div class="balance-section">
          <SettlementPlan
            plan={settlementPlan()}
            currency={currency()}
            members={members()}
            disabled={props.disabled}
          />
        </div>
      </Show>
    </div>
  )
}
