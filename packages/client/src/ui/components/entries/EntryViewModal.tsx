import { Component, Show, For } from 'solid-js';
import { useI18n, formatCurrency } from '../../../i18n';
import { useAppContext } from '../../context/AppContext';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import type { Entry, ExpenseEntry, TransferEntry, ExpenseCategory } from '@partage/shared';

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
};

export interface EntryViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: Entry;
  onEdit?: () => void;
  onDelete?: () => void;
}

export const EntryViewModal: Component<EntryViewModalProps> = (props) => {
  const { t, locale } = useI18n();
  const { loroStore, activeGroup } = useAppContext();

  const formatAmount = (amount: number, currency: string): string => {
    return formatCurrency(amount, currency, locale());
  };

  const formatDate = (timestamp: number): string => {
    const localeCode = locale() === 'fr' ? 'fr-FR' : locale() === 'es' ? 'es-ES' : 'en-US';
    return new Date(timestamp).toLocaleDateString(localeCode, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (timestamp: number): string => {
    const localeCode = locale() === 'fr' ? 'fr-FR' : locale() === 'es' ? 'es-ES' : 'en-US';
    return new Date(timestamp).toLocaleString(localeCode, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getMemberName = (memberId: string): string => {
    const store = loroStore();
    if (!store) {
      return t('common.unknown');
    }

    const canonicalIdMap = store.getCanonicalIdMap();
    const allStates = store.getAllMemberStates();

    const canonicalId = canonicalIdMap.get(memberId) ?? memberId;
    const canonicalState = allStates.get(canonicalId);
    const state = allStates.get(memberId);

    return canonicalState?.name ?? state?.name ?? t('common.unknown');
  };

  const isExpense = (): boolean => props.entry?.type === 'expense';
  const isTransfer = (): boolean => props.entry?.type === 'transfer';

  const expenseEntry = () => (isExpense() ? (props.entry as ExpenseEntry) : null);
  const transferEntry = () => (isTransfer() ? (props.entry as TransferEntry) : null);

  // Calculate split amounts for beneficiaries
  const calculateBeneficiarySplitAmounts = (): Map<string, number> => {
    const expense = expenseEntry();
    if (!expense) return new Map();

    const totalAmount = props.entry.defaultCurrencyAmount ?? props.entry.amount;
    const beneficiaries = expense.beneficiaries;
    const splits = new Map<string, number>();

    // Separate by split type
    const sharesBeneficiaries = beneficiaries.filter((b) => b.splitType === 'shares');
    const exactBeneficiaries = beneficiaries.filter((b) => b.splitType === 'exact');

    // Calculate exact amounts first
    let exactTotal = 0;
    for (const beneficiary of exactBeneficiaries) {
      const amount = beneficiary.amount ?? 0;
      const defaultCurrencyValue =
        props.entry.currency === activeGroup()?.defaultCurrency
          ? amount
          : (amount / props.entry.amount) * totalAmount;
      splits.set(
        beneficiary.memberId,
        (splits.get(beneficiary.memberId) ?? 0) + defaultCurrencyValue
      );
      exactTotal += defaultCurrencyValue;
    }

    // Calculate shares from remaining amount
    if (sharesBeneficiaries.length > 0) {
      const remainingAmount = totalAmount - exactTotal;
      const totalShares = sharesBeneficiaries.reduce((sum, b) => sum + (b.shares ?? 1), 0);

      const remainingCents = Math.round(remainingAmount * 100);
      const centsPerShare = Math.floor(remainingCents / totalShares);
      let remainderCents = remainingCents - centsPerShare * totalShares;

      const sortedBeneficiaries = [...sharesBeneficiaries].sort((a, b) =>
        a.memberId.localeCompare(b.memberId)
      );

      for (const beneficiary of sortedBeneficiaries) {
        const shares = beneficiary.shares ?? 1;
        let amountCents = centsPerShare * shares;

        if (remainderCents > 0 && shares > 0) {
          const extraCents = Math.min(remainderCents, shares);
          amountCents += extraCents;
          remainderCents -= extraCents;
        }

        splits.set(
          beneficiary.memberId,
          (splits.get(beneficiary.memberId) ?? 0) + amountCents / 100
        );
      }
    }

    return splits;
  };

  const getCategoryEmoji = (): string => {
    const expense = expenseEntry();
    if (!expense || !expense.category) return '📝';
    return CATEGORY_EMOJI[expense.category as ExpenseCategory] || '📝';
  };

  const formatAmountWithDefault = (): string => {
    if (!props.entry) return '';

    const defaultCurrency = activeGroup()?.defaultCurrency;
    const entryCurrency = props.entry.currency;
    const entryAmount = props.entry.amount;
    const defaultAmount = props.entry.defaultCurrencyAmount;

    let result = formatAmount(entryAmount, entryCurrency!);

    if (
      defaultCurrency &&
      entryCurrency !== defaultCurrency &&
      defaultAmount !== undefined &&
      defaultAmount !== entryAmount
    ) {
      result += ` (${formatAmount(defaultAmount, defaultCurrency)})`;
    }

    return result;
  };

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title={t('activity.entryDetails')}>
      <Show when={props.entry}>
        <div style={{ padding: 'var(--space-md)' }}>
          {/* Header */}
          <div
            style={{
              display: 'flex',
              'align-items': 'flex-start',
              gap: 'var(--space-md)',
              'margin-bottom': 'var(--space-lg)',
            }}
          >
            <div
              style={{
                'font-size': '2rem',
                'flex-shrink': '0',
              }}
            >
              {isTransfer() ? '💸' : getCategoryEmoji()}
            </div>
            <div style={{ flex: '1' }}>
              <Show when={isExpense()}>
                <h3
                  style={{
                    margin: '0 0 var(--space-xs) 0',
                    'font-size': 'var(--font-size-lg)',
                    'font-weight': 'var(--font-weight-semibold)',
                  }}
                >
                  {expenseEntry()!.description}
                </h3>
              </Show>
              <Show when={isTransfer()}>
                <h3
                  style={{
                    margin: '0 0 var(--space-xs) 0',
                    'font-size': 'var(--font-size-lg)',
                    'font-weight': 'var(--font-weight-semibold)',
                  }}
                >
                  {t('entries.transfer')}
                </h3>
              </Show>
              <div
                style={{
                  'font-size': 'var(--font-size-xl)',
                  color: 'var(--color-primary)',
                  'font-weight': 'var(--font-weight-semibold)',
                }}
              >
                {formatAmountWithDefault()}
              </div>
            </div>
          </div>

          {/* Expense Details */}
          <Show when={isExpense()}>
            <div class="detail-section">
              <Show when={expenseEntry()!.category}>
                <div class="detail-row">
                  <span class="detail-label">{t('entries.category')}:</span>
                  <span class="detail-value">
                    {t(`categories.${expenseEntry()!.category}`)}
                  </span>
                </div>
              </Show>

              <div class="detail-row">
                <span class="detail-label">{t('entries.date')}:</span>
                <span class="detail-value">
                  {formatDate(props.entry.date)}
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.paidBy')}:</span>
                <span class="detail-value">
                  <For each={expenseEntry()!.payers}>
                    {(payer, index) => (
                      <>
                        {index() > 0 && ', '}
                        {getMemberName(payer.memberId)} (
                        {formatAmount(payer.amount, props.entry.currency)})
                      </>
                    )}
                  </For>
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.split')}:</span>
                <div
                  class="detail-value"
                  style="display: flex; flex-direction: column; gap: var(--space-xs);"
                >
                  <For each={expenseEntry()!.beneficiaries}>
                    {(beneficiary) => {
                      const splitAmounts = calculateBeneficiarySplitAmounts();
                      const splitAmount = splitAmounts.get(beneficiary.memberId) ?? 0;
                      const defaultCurrency = activeGroup()?.defaultCurrency;
                      return (
                        <div>
                          {getMemberName(beneficiary.memberId)}:{' '}
                          {beneficiary.splitType === 'shares' &&
                            beneficiary.shares &&
                            `${beneficiary.shares} ${t('entries.shares')} = `}
                          {formatAmount(splitAmount, defaultCurrency || 'USD')}
                        </div>
                      );
                    }}
                  </For>
                </div>
              </div>

              <Show when={expenseEntry()!.notes}>
                <div class="detail-row">
                  <span class="detail-label">{t('entries.notes')}:</span>
                  <span class="detail-value">
                    {expenseEntry()!.notes}
                  </span>
                </div>
              </Show>
            </div>
          </Show>

          {/* Transfer Details */}
          <Show when={isTransfer()}>
            <div class="detail-section">
              <div class="detail-row">
                <span class="detail-label">{t('entries.date')}:</span>
                <span class="detail-value">
                  {formatDate(props.entry.date)}
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.from')}:</span>
                <span class="detail-value">
                  {getMemberName(transferEntry()!.from)}
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.to')}:</span>
                <span class="detail-value">
                  {getMemberName(transferEntry()!.to)}
                </span>
              </div>

              <Show when={props.entry.notes}>
                <div class="detail-row">
                  <span class="detail-label">{t('entries.notes')}:</span>
                  <span class="detail-value">
                    {props.entry.notes}
                  </span>
                </div>
              </Show>
            </div>
          </Show>

          {/* Metadata */}
          <div
            class="metadata-section"
            style={{
              'margin-top': 'var(--space-lg)',
              'padding-top': 'var(--space-md)',
              'border-top': '1px solid var(--color-border)',
              'font-size': 'var(--font-size-sm)',
              color: 'var(--color-text-light)',
            }}
          >
            <Show
              when={props.entry.modifiedAt}
              fallback={
                <div>
                  {t('entries.createdAt')}: {formatDateTime(props.entry.createdAt)}
                </div>
              }
            >
              <div>
                {t('entries.modifiedAt')}: {formatDateTime(props.entry.modifiedAt!)}
              </div>
            </Show>
          </div>

          {/* Action Buttons */}
          <Show when={props.onEdit || props.onDelete}>
            <div
              style={{
                'margin-top': 'var(--space-lg)',
                display: 'flex',
                'justify-content': 'flex-end',
                gap: 'var(--space-sm)',
              }}
            >
              <Show when={props.onEdit}>
                <Button variant="primary" onClick={props.onEdit}>
                  {t('common.edit')}
                </Button>
              </Show>
              <Show when={props.onDelete}>
                <Button variant="danger" onClick={props.onDelete}>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    style={{ 'margin-right': 'var(--space-xs)' }}
                  >
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                  {t('common.delete')}
                </Button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </Modal>
  );
};
