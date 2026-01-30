import { Component, Show, For, createSignal, createMemo } from 'solid-js';
import { useI18n, formatCurrency } from '../../../i18n';
import { useAppContext } from '../../context/AppContext';
import { Button } from '../common/Button';
import type { SettlementPlan as SettlementPlanType, Member } from '@partage/shared';

export interface SettlementPlanProps {
  plan: SettlementPlanType;
  currency: string;
  members: Member[];
  disabled?: boolean;
}

export const SettlementPlan: Component<SettlementPlanProps> = (props) => {
  const { t, locale } = useI18n();
  const { addTransfer, identity, loroStore } = useAppContext();
  const [isSettling, setIsSettling] = createSignal<string | null>(null);

  // Memoize the canonical user ID to avoid repeated resolution
  const canonicalUserId = createMemo(() => {
    const userId = identity()?.publicKeyHash;
    if (!userId) return '';
    const store = loroStore();
    if (!store) return userId;
    return store.resolveCanonicalMemberId(userId);
  });

  // Memoized member name lookup map - uses canonical ID resolution
  const memberNameMap = createMemo(() => {
    const nameMap = new Map<string, string>();
    const store = loroStore();

    if (!store) {
      // Fallback to props.members
      for (const member of props.members) {
        nameMap.set(member.id, member.name);
      }
      return nameMap;
    }

    // Use event-based system: resolve each member to their canonical name
    const canonicalIdMap = store.getCanonicalIdMap();
    const allStates = store.getAllMemberStates();

    for (const [memberId, state] of allStates) {
      const canonicalId = canonicalIdMap.get(memberId) ?? memberId;
      const canonicalState = allStates.get(canonicalId);
      nameMap.set(memberId, canonicalState?.name ?? state.name);
    }

    return nameMap;
  });

  // O(1) member name lookup using memoized map
  const getMemberName = (memberId: string): string => {
    return memberNameMap().get(memberId) || t('common.unknown');
  };

  const handleSettle = async (fromId: string, toId: string, amount: number) => {
    const settlementKey = `${fromId}-${toId}`;
    try {
      setIsSettling(settlementKey);

      await addTransfer({
        amount,
        currency: props.currency,
        from: fromId,
        to: toId,
        date: Date.now(),
        notes: t('settle.settlementPayment'),
      });

      // Success - balance will update automatically via context
    } catch (err) {
      console.error('Failed to record settlement:', err);
      // Error is handled by context
    } finally {
      setIsSettling(null);
    }
  };

  // Check if current user is involved in a transaction (using memoized canonical ID)
  const isUserInvolved = (fromId: string, toId: string): boolean => {
    const userId = identity()?.publicKeyHash;
    if (!userId) return false;

    // Check direct match or canonical ID match
    const canonical = canonicalUserId();
    return userId === fromId || userId === toId || canonical === fromId || canonical === toId;
  };

  return (
    <Show
      when={props.plan.transactions.length > 0}
      fallback={
        <div class="settlement-empty">
          <div class="text-center p-lg">
            <div class="text-xl mb-sm">✓</div>
            <p class="text-base font-semibold mb-xs">{t('settle.allSettledUp')}</p>
            <p class="text-sm text-muted">{t('settle.allSettledDescription')}</p>
          </div>
        </div>
      }
    >
      <div class="settlement-plan">
        <div class="settlement-header">
          <h3 class="text-lg font-semibold">{t('settle.suggestedSettlements')}</h3>
          <p class="text-sm text-muted">
            {props.plan.totalTransactions === 1
              ? t('settle.paymentCount', { count: props.plan.totalTransactions })
              : t('settle.paymentCountPlural', { count: props.plan.totalTransactions })}
          </p>
        </div>

        <div class="settlement-list">
          <For each={props.plan.transactions}>
            {(transaction) => {
              const settlementKey = `${transaction.from}-${transaction.to}`;
              const loading = isSettling() === settlementKey;
              const involved = isUserInvolved(transaction.from, transaction.to);

              return (
                <div class={`settlement-item ${involved ? 'settlement-item-involved' : ''}`}>
                  <div class="settlement-row-1">
                    <div class="settlement-flow">
                      <span class="settlement-from">{getMemberName(transaction.from)}</span>
                      <span class="settlement-arrow">→</span>
                      <span class="settlement-to">{getMemberName(transaction.to)}</span>
                    </div>
                    <div class="settlement-amount">
                      {formatCurrency(transaction.amount, props.currency, locale())}
                    </div>
                  </div>

                  <Show when={!props.disabled}>
                    <div class="settlement-row-2">
                      <Button
                        variant="primary"
                        size="small"
                        onClick={() =>
                          handleSettle(transaction.from, transaction.to, transaction.amount)
                        }
                        disabled={loading}
                      >
                        {loading ? t('settle.recording') : t('settle.markAsPaid')}
                      </Button>
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>

        <div class="settlement-note">
          <p class="text-xs text-muted">💡 {t('settle.tip')}</p>
        </div>
      </div>
    </Show>
  );
};
