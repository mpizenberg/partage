import { Component, Show, For, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { BalanceCard } from './BalanceCard'
import { SettlementPlan } from './SettlementPlan'

export interface BalanceTabProps {
  onPayMember?: (memberId: string, memberName: string, amount: number) => void
}

export const BalanceTab: Component<BalanceTabProps> = (props) => {
  const { balances, settlementPlan, activeGroup, members, identity, entries, loroStore } = useAppContext()

  // Check if a member ID represents the current user (considering aliases)
  const isCurrentUserMember = (memberId: string): boolean => {
    const userId = identity()?.publicKeyHash
    if (!userId) return false
    if (memberId === userId) return true

    // Check if this is a virtual member claimed by the current user
    const store = loroStore()
    if (!store) return false

    const canonicalId = store.resolveCanonicalMemberId(userId)
    return memberId === canonicalId
  }

  const getMemberName = (memberId: string): string => {
    if (isCurrentUserMember(memberId)) return 'You'

    const store = loroStore()

    // Check if this is a canonical ID (old virtual member) that has been claimed
    if (store) {
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

    // Try filtered members list
    let member = members().find(m => m.id === memberId)

    // If not found, check full Loro member list (includes replaced virtual members)
    if (!member && store) {
      const allMembers = store.getMembers()
      member = allMembers.find(m => m.id === memberId)
    }

    return member?.name || 'Unknown'
  }

  const myUserId = createMemo(() => {
    const userId = identity()?.publicKeyHash
    if (!userId) return ''

    // Resolve to canonical ID (if user claimed a virtual member)
    const store = loroStore()
    if (!store) return userId

    return store.resolveCanonicalMemberId(userId)
  })

  const allBalances = createMemo(() => {
    const canonicalUserId = myUserId()
    if (!canonicalUserId) return []

    // Put current user first, then others sorted by absolute balance
    const userBalance = balances().get(canonicalUserId)
    const otherBalances = Array.from(balances().entries())
      .filter(([memberId]) => memberId !== canonicalUserId)
      .sort((a, b) => Math.abs(b[1].netBalance) - Math.abs(a[1].netBalance))

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
            <h2 class="empty-state-title">No Balances Yet</h2>
            <p class="empty-state-message">
              Add expenses to see balance calculations and settlement suggestions
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
                  onPayMember={props.onPayMember}
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
          />
        </div>
      </Show>
    </div>
  )
}
