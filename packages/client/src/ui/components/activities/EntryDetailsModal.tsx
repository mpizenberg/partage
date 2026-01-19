import { Component, Show, For } from 'solid-js';
import { useI18n, formatCurrency } from '../../../i18n';
import { useAppContext } from '../../context/AppContext';
import { Modal } from '../common/Modal';
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

export interface EntryDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  entry: Entry | null;
  changes?: Record<string, { from: any; to: any }>;
  deletionReason?: string;
  payerNames?: Record<string, string>;
  beneficiaryNames?: Record<string, string>;
  fromName?: string;
  toName?: string;
}

export const EntryDetailsModal: Component<EntryDetailsModalProps> = (props) => {
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
    // Try to use historical names from activity first
    if (props.payerNames?.[memberId]) return props.payerNames[memberId];
    if (props.beneficiaryNames?.[memberId]) return props.beneficiaryNames[memberId];

    const store = loroStore();
    if (!store) {
      return t('common.unknown');
    }

    const allStates = store.getAllMemberStates();
    const state = allStates.get(memberId);

    return state?.name ?? t('common.unknown');
  };

  const isExpense = (): boolean => props.entry?.type === 'expense';
  const isTransfer = (): boolean => props.entry?.type === 'transfer';

  const expenseEntry = () => (isExpense() ? (props.entry as ExpenseEntry) : null);
  const transferEntry = () => (isTransfer() ? (props.entry as TransferEntry) : null);

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

  const formatChangeValue = (value: any, field: string): string => {
    if (value == null) return t('activity.none');

    if (typeof value === 'number') {
      if (field === 'amount' && props.entry) {
        return formatAmount(value, props.entry.currency);
      }
      if (field === 'date') {
        return formatDate(value);
      }
      return String(value);
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return t('activity.none');
      if (value[0] && typeof value[0] === 'object' && 'memberId' in value[0]) {
        const memberNames = value.map((item: any) => getMemberName(item.memberId));
        return memberNames.join(', ');
      }
      return value.map((id: string) => getMemberName(id)).join(', ');
    }

    if (typeof value === 'string') {
      return value;
    }

    return JSON.stringify(value);
  };

  const hasChanges = (): boolean => {
    return Boolean(props.changes && Object.keys(props.changes).length > 0);
  };

  const isFieldChanged = (field: string): boolean => {
    return Boolean(props.changes && field in props.changes);
  };

  // Helper to format amount with optional default currency in parenthesis
  const showAmount = (
    amount: number,
    defaultCurrencyAmount: number | undefined,
    currency: string
  ): string => {
    const defCurrency = activeGroup()?.defaultCurrency;
    let result = formatAmount(amount, currency);

    // If currency is different from default and we have a defaultCurrencyAmount, show it in parenthesis
    if (
      defCurrency &&
      currency !== defCurrency &&
      defaultCurrencyAmount !== undefined &&
      defaultCurrencyAmount !== amount
    ) {
      result += ` (${formatAmount(defaultCurrencyAmount, defCurrency)})`;
    }

    return result;
  };

  // Helper to check if we should show multi-currency amount display
  const shouldShowMultiCurrencyAmount = (): boolean => {
    if (!props.entry || !props.changes) return false;
    if (!('amount' in props.changes || 'defaultCurrencyAmount' in props.changes)) return false;

    // Get old and new currencies
    const oldCurrency = props.changes.currency?.from ?? props.entry.currency;
    const newCurrency = props.changes.currency?.to ?? props.entry.currency;
    const defCurrency = activeGroup()?.defaultCurrency;

    // Show multi-currency display if either old or new currency is not default
    return oldCurrency !== defCurrency || newCurrency !== defCurrency;
  };

  const getOldCurrency = (): string => {
    if (!props.entry || !props.changes) return '';
    return props.changes.currency?.from ?? props.entry.currency;
  };

  const getNewCurrency = (): string => {
    if (!props.entry || !props.changes) return '';
    return props.changes.currency?.to ?? props.entry.currency;
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
                  classList={{ 'field-changed': isFieldChanged('description') }}
                >
                  {expenseEntry()!.description}
                </h3>
              </Show>
              <div
                style={{
                  'font-size': 'var(--font-size-xl)',
                  color: 'var(--color-primary)',
                  'font-weight': 'var(--font-weight-semibold)',
                }}
                classList={{ 'field-changed': isFieldChanged('amount') }}
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
                  <span
                    class="detail-value"
                    classList={{ 'field-changed': isFieldChanged('category') }}
                  >
                    {t(`categories.${expenseEntry()!.category}`)}
                  </span>
                </div>
              </Show>

              <div class="detail-row">
                <span class="detail-label">{t('entries.date')}:</span>
                <span class="detail-value" classList={{ 'field-changed': isFieldChanged('date') }}>
                  {formatDate(props.entry!.date)}
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.paidBy')}:</span>
                <span
                  class="detail-value"
                  classList={{ 'field-changed': isFieldChanged('payers') }}
                >
                  <For each={expenseEntry()!.payers}>
                    {(payer, index) => (
                      <>
                        {index() > 0 && ', '}
                        {getMemberName(payer.memberId)} (
                        {formatAmount(payer.amount, props.entry!.currency)})
                      </>
                    )}
                  </For>
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.split')}:</span>
                <span
                  class="detail-value"
                  classList={{ 'field-changed': isFieldChanged('beneficiaries') }}
                >
                  <For each={expenseEntry()!.beneficiaries}>
                    {(beneficiary, index) => (
                      <>
                        {index() > 0 && ', '}
                        {getMemberName(beneficiary.memberId)}
                        {beneficiary.splitType === 'shares' &&
                          beneficiary.shares &&
                          ` (${beneficiary.shares} ${t('entries.shares')})`}
                        {beneficiary.splitType === 'exact' &&
                          beneficiary.amount !== undefined &&
                          ` (${formatAmount(beneficiary.amount, props.entry!.currency)})`}
                      </>
                    )}
                  </For>
                </span>
              </div>

              <Show when={expenseEntry()!.notes}>
                <div class="detail-row">
                  <span class="detail-label">{t('entries.notes')}:</span>
                  <span
                    class="detail-value"
                    classList={{ 'field-changed': isFieldChanged('notes') }}
                  >
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
                <span class="detail-value" classList={{ 'field-changed': isFieldChanged('date') }}>
                  {formatDate(props.entry!.date)}
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.from')}:</span>
                <span class="detail-value" classList={{ 'field-changed': isFieldChanged('from') }}>
                  {props.fromName || getMemberName(transferEntry()!.from)}
                </span>
              </div>

              <div class="detail-row">
                <span class="detail-label">{t('entries.to')}:</span>
                <span class="detail-value" classList={{ 'field-changed': isFieldChanged('to') }}>
                  {props.toName || getMemberName(transferEntry()!.to)}
                </span>
              </div>

              <Show when={props.entry!.notes}>
                <div class="detail-row">
                  <span class="detail-label">{t('entries.notes')}:</span>
                  <span
                    class="detail-value"
                    classList={{ 'field-changed': isFieldChanged('notes') }}
                  >
                    {props.entry!.notes}
                  </span>
                </div>
              </Show>
            </div>
          </Show>

          {/* Changes Section */}
          <Show when={hasChanges()}>
            <div
              class="changes-section"
              style={{
                'margin-top': 'var(--space-lg)',
                padding: 'var(--space-md)',
                background: 'var(--color-bg-secondary)',
                'border-radius': 'var(--border-radius)',
              }}
            >
              <h4
                style={{
                  margin: '0 0 var(--space-md) 0',
                  'font-size': 'var(--font-size-md)',
                  'font-weight': 'var(--font-weight-semibold)',
                  color: 'var(--color-text-light)',
                }}
              >
                {t('activity.changes')}
              </h4>
              <For
                each={Object.entries(props.changes || {}).filter(([f]) => {
                  const isNotesOrCurrency = f === 'notes' || f === 'currency';
                  const isAmountField = f === 'amount' || f === 'defaultCurrencyAmount';
                  return !isNotesOrCurrency && !(shouldShowMultiCurrencyAmount() && isAmountField);
                })}
              >
                {([field, change]) => (
                  <div
                    class="change-row"
                    style={{
                      'margin-bottom': 'var(--space-sm)',
                      'font-size': 'var(--font-size-sm)',
                    }}
                  >
                    <div
                      style={{
                        color: 'var(--color-text-light)',
                        'font-weight': 'var(--font-weight-medium)',
                        'margin-bottom': 'var(--space-xs)',
                      }}
                    >
                      {field}:
                    </div>
                    <div
                      style={{ display: 'flex', 'align-items': 'center', gap: 'var(--space-sm)' }}
                    >
                      <span
                        style={{
                          'text-decoration': 'line-through',
                          color: 'var(--color-danger)',
                          flex: '1',
                        }}
                      >
                        {formatChangeValue(change.from, field)}
                      </span>
                      <span style={{ color: 'var(--color-text-light)' }}>→</span>
                      <span
                        style={{
                          color: 'var(--color-success)',
                          'font-weight': 'var(--font-weight-medium)',
                          flex: '1',
                        }}
                      >
                        {formatChangeValue(change.to, field)}
                      </span>
                    </div>
                  </div>
                )}
              </For>

              {/* Multi-currency amount display */}
              <Show when={shouldShowMultiCurrencyAmount()}>
                <div
                  class="change-row"
                  style={{
                    'margin-bottom': 'var(--space-sm)',
                    'font-size': 'var(--font-size-sm)',
                  }}
                >
                  <div
                    style={{
                      color: 'var(--color-text-light)',
                      'font-weight': 'var(--font-weight-medium)',
                      'margin-bottom': 'var(--space-xs)',
                    }}
                  >
                    amount:
                  </div>
                  <div style={{ display: 'flex', 'align-items': 'center', gap: 'var(--space-sm)' }}>
                    <span
                      style={{
                        'text-decoration': 'line-through',
                        color: 'var(--color-danger)',
                        flex: '1',
                      }}
                    >
                      {showAmount(
                        props.changes?.amount?.from ?? props.entry!.amount,
                        props.changes?.defaultCurrencyAmount?.from ??
                          (getOldCurrency() === activeGroup()?.defaultCurrency
                            ? (props.changes?.amount?.from ?? props.entry!.amount)
                            : props.entry!.defaultCurrencyAmount),
                        getOldCurrency()
                      )}
                    </span>
                    <span style={{ color: 'var(--color-text-light)' }}>→</span>
                    <span
                      style={{
                        color: 'var(--color-success)',
                        'font-weight': 'var(--font-weight-medium)',
                        flex: '1',
                      }}
                    >
                      {showAmount(
                        props.changes?.amount?.to ?? props.entry!.amount,
                        props.changes?.defaultCurrencyAmount?.to ??
                          (getNewCurrency() === activeGroup()?.defaultCurrency
                            ? (props.changes?.amount?.to ?? props.entry!.amount)
                            : props.entry!.defaultCurrencyAmount),
                        getNewCurrency()
                      )}
                    </span>
                  </div>
                </div>
              </Show>

              {/* Special display for notes changes */}
              <Show when={props.changes?.notes}>
                <div
                  class="change-row"
                  style={{
                    'margin-bottom': 'var(--space-md)',
                    'font-size': 'var(--font-size-sm)',
                  }}
                >
                  <div
                    style={{
                      color: 'var(--color-text-light)',
                      'font-weight': 'var(--font-weight-medium)',
                      'margin-bottom': 'var(--space-sm)',
                    }}
                  >
                    {t('entries.notes')}:
                  </div>
                  <div
                    style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--space-sm)' }}
                  >
                    <div
                      style={{
                        padding: 'var(--space-sm)',
                        background: 'var(--color-danger-light)',
                        'border-left': '3px solid var(--color-danger)',
                        'border-radius': 'var(--radius-sm)',
                        'white-space': 'pre-wrap',
                      }}
                    >
                      <div
                        style={{
                          'font-weight': 'var(--font-weight-medium)',
                          'margin-bottom': 'var(--space-xs)',
                          color: 'var(--color-danger)',
                        }}
                      >
                        {t('activity.previousVersion')}:
                      </div>
                      {props.changes!.notes!.from || t('activity.none')}
                    </div>
                    <div
                      style={{
                        padding: 'var(--space-sm)',
                        background: 'var(--color-success-light)',
                        'border-left': '3px solid var(--color-success)',
                        'border-radius': 'var(--radius-sm)',
                        'white-space': 'pre-wrap',
                      }}
                    >
                      <div
                        style={{
                          'font-weight': 'var(--font-weight-medium)',
                          'margin-bottom': 'var(--space-xs)',
                          color: 'var(--color-success)',
                        }}
                      >
                        {t('activity.newVersion')}:
                      </div>
                      {props.changes!.notes!.to || t('activity.none')}
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Deletion Reason */}
          <Show when={props.deletionReason}>
            <div
              class="deletion-reason"
              style={{
                'margin-top': 'var(--space-lg)',
                padding: 'var(--space-md)',
                background: 'var(--color-danger-light)',
                'border-left': '4px solid var(--color-danger)',
                'border-radius': 'var(--border-radius)',
              }}
            >
              <div
                style={{
                  'font-weight': 'var(--font-weight-semibold)',
                  color: 'var(--color-danger)',
                  'margin-bottom': 'var(--space-xs)',
                }}
              >
                {t('activity.deletionReason')}:
              </div>
              <div style={{ color: 'var(--color-text)' }}>{props.deletionReason}</div>
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
            {/* Show only the most relevant date based on entry state */}
            <Show
              when={props.entry!.deletedAt}
              fallback={
                <Show
                  when={props.entry!.modifiedAt}
                  fallback={
                    <div>
                      {t('entries.createdAt')}: {formatDateTime(props.entry!.createdAt)}
                    </div>
                  }
                >
                  <div>
                    {t('entries.modifiedAt')}: {formatDateTime(props.entry!.modifiedAt!)}
                  </div>
                </Show>
              }
            >
              <div>
                {t('entries.deletedAt')}: {formatDateTime(props.entry!.deletedAt!)}
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </Modal>
  );
};
