import { Component, createSignal, For, Show, createMemo } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { useI18n } from '../../../i18n';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
import type { ExpenseFormData, FormErrors } from './types';
import type { ExpenseCategory, SplitType, Payer, Beneficiary, ExpenseEntry } from '@partage/shared';

const CATEGORIES: { value: ExpenseCategory; labelKey: string; emoji: string }[] = [
  { value: 'food', labelKey: 'categories.food', emoji: '🍔' },
  { value: 'transport', labelKey: 'categories.transport', emoji: '🚗' },
  { value: 'accommodation', labelKey: 'categories.accommodation', emoji: '🏨' },
  { value: 'entertainment', labelKey: 'categories.entertainment', emoji: '🎬' },
  { value: 'shopping', labelKey: 'categories.shopping', emoji: '🛍️' },
  { value: 'groceries', labelKey: 'categories.groceries', emoji: '🛒' },
  { value: 'utilities', labelKey: 'categories.utilities', emoji: '💡' },
  { value: 'healthcare', labelKey: 'categories.healthcare', emoji: '⚕️' },
  { value: 'other', labelKey: 'categories.other', emoji: '📝' },
];

export interface ExpenseFormProps {
  onSubmit: (data: ExpenseFormData) => Promise<void>;
  onCancel: () => void;
  initialData?: ExpenseEntry;
}

export const ExpenseForm: Component<ExpenseFormProps> = (props) => {
  const { members, activeGroup, identity } = useAppContext();
  const { t } = useI18n();

  // Sorted active members: current user first, then others alphabetically (case-insensitive)
  const sortedActiveMembers = createMemo(() => {
    const currentUserId = identity()?.publicKeyHash;
    const membersList = members().filter((m) => m.status === 'active');

    const currentUser = membersList.filter((m) => m.id === currentUserId);
    const others = membersList
      .filter((m) => m.id !== currentUserId)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    return [...currentUser, ...others];
  });

  // Sorted departed members (alphabetically)
  const sortedDepartedMembers = createMemo(() => {
    return members()
      .filter((m) => m.status === 'departed')
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  });

  const [showDepartedMembers, setShowDepartedMembers] = createSignal(false);

  // Helper functions to extract initial data
  const getInitialBeneficiaries = (): Set<string> => {
    if (!props.initialData) {
      return new Set([identity()?.publicKeyHash || '']);
    }
    return new Set(props.initialData.beneficiaries.map((b) => b.memberId));
  };

  const getInitialSplitType = (): SplitType => {
    if (!props.initialData || props.initialData.beneficiaries.length === 0) {
      return 'shares';
    }
    return props.initialData.beneficiaries[0]?.splitType || 'shares';
  };

  const getInitialShares = (): Map<string, number> => {
    const map = new Map<string, number>();
    if (props.initialData) {
      props.initialData.beneficiaries.forEach((b) => {
        if (b.splitType === 'shares' && b.shares !== undefined) {
          map.set(b.memberId, b.shares);
        }
      });
    }
    return map;
  };

  const getInitialAmounts = (): Map<string, number> => {
    const map = new Map<string, number>();
    if (props.initialData) {
      props.initialData.beneficiaries.forEach((b) => {
        if (b.splitType === 'exact' && b.amount !== undefined) {
          map.set(b.memberId, b.amount);
        }
      });
    }
    return map;
  };

  const formatDateForInput = (timestamp: number): string => {
    return new Date(timestamp).toISOString().split('T')[0] || '';
  };

  // Basic fields - initialized from props.initialData if present
  const [amount, setAmount] = createSignal(props.initialData?.amount.toString() || '');
  const [description, setDescription] = createSignal(props.initialData?.description || '');
  const [currency, setCurrency] = createSignal(
    props.initialData?.currency || activeGroup()?.defaultCurrency || 'USD'
  );
  const [defaultCurrencyAmount, setDefaultCurrencyAmount] = createSignal(
    props.initialData?.defaultCurrencyAmount?.toString() || ''
  );
  const [date, setDate] = createSignal(
    props.initialData
      ? formatDateForInput(props.initialData.date)
      : new Date().toISOString().split('T')[0]
  );
  const [category, setCategory] = createSignal<ExpenseCategory | ''>(
    props.initialData?.category || ''
  );
  const [location, setLocation] = createSignal(props.initialData?.location || '');
  const [notes, setNotes] = createSignal(props.initialData?.notes || '');
  const [showAdvanced, setShowAdvanced] = createSignal(
    !!(props.initialData?.category || props.initialData?.location || props.initialData?.notes)
  );

  // Payers: Single payer mode (default) and multiple payers mode
  const [multiplePayers, setMultiplePayers] = createSignal(
    props.initialData ? props.initialData.payers.length > 1 : false
  );

  // Single payer mode
  const [payerId, setPayerId] = createSignal(
    props.initialData?.payers[0]?.memberId || identity()?.publicKeyHash || ''
  );

  // Multiple payers mode
  const getInitialPayers = (): Set<string> => {
    if (!props.initialData) {
      return new Set([identity()?.publicKeyHash || '']);
    }
    return new Set(props.initialData.payers.map((p) => p.memberId));
  };

  const getInitialPayerAmounts = (): Map<string, number> => {
    const map = new Map<string, number>();
    if (props.initialData) {
      props.initialData.payers.forEach((p) => {
        map.set(p.memberId, p.amount);
      });
    }
    return map;
  };

  const [selectedPayers, setSelectedPayers] = createSignal<Set<string>>(getInitialPayers());
  const [payerAmounts, setPayerAmounts] =
    createSignal<Map<string, number>>(getInitialPayerAmounts());

  // Beneficiaries: Track selected members and their shares/amounts
  const [selectedBeneficiaries, setSelectedBeneficiaries] =
    createSignal<Set<string>>(getInitialBeneficiaries());
  const [splitType, setSplitType] = createSignal<SplitType>(getInitialSplitType());
  const [beneficiaryShares, setBeneficiaryShares] =
    createSignal<Map<string, number>>(getInitialShares());
  const [beneficiaryAmounts, setBeneficiaryAmounts] =
    createSignal<Map<string, number>>(getInitialAmounts());

  // Check if we're in edit mode
  const isEditMode = () => !!props.initialData;

  const [errors, setErrors] = createSignal<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = createSignal(false);

  // Check if currency is different from default
  const isNonDefaultCurrency = createMemo(() => {
    const defaultCurrency = activeGroup()?.defaultCurrency || 'USD';
    return currency() !== defaultCurrency;
  });

  // Get default currency
  const getDefaultCurrency = () => {
    return activeGroup()?.defaultCurrency || 'USD';
  };

  // Calculate exchange rate (original to default)
  const exchangeRate = createMemo(() => {
    const amountNum = parseFloat(amount());
    const defaultAmountNum = parseFloat(defaultCurrencyAmount());

    if (isNaN(amountNum) || isNaN(defaultAmountNum) || amountNum === 0) {
      return null;
    }

    return defaultAmountNum / amountNum;
  });

  // Calculate inverse exchange rate (default to original)
  const inverseExchangeRate = createMemo(() => {
    const rate = exchangeRate();
    if (!rate || rate === 0) return null;
    return 1 / rate;
  });

  // Format exchange rate display
  const formatExchangeRate = (rate: number | null): string => {
    if (!rate) return '';
    return rate.toFixed(3);
  };

  // Calculate shares for display
  const calculatedShares = createMemo(() => {
    const amountNum = parseFloat(amount());
    if (isNaN(amountNum) || amountNum <= 0) return new Map<string, number>();

    if (splitType() === 'exact') {
      return beneficiaryAmounts();
    }

    // Calculate from shares
    const shares = beneficiaryShares();
    const selectedIds = Array.from(selectedBeneficiaries());
    const totalShares = selectedIds.reduce((sum, id) => sum + (shares.get(id) || 1), 0);

    const result = new Map<string, number>();
    selectedIds.forEach((id) => {
      const memberShares = shares.get(id) || 1;
      result.set(id, (amountNum * memberShares) / totalShares);
    });
    return result;
  });

  const togglePayer = (memberId: string) => {
    const newSet = new Set(selectedPayers());
    if (newSet.has(memberId)) {
      newSet.delete(memberId);
    } else {
      newSet.add(memberId);
    }
    setSelectedPayers(newSet);
  };

  const updatePayerAmount = (memberId: string, value: string) => {
    const newAmounts = new Map(payerAmounts());
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      newAmounts.set(memberId, numValue);
    } else {
      newAmounts.delete(memberId);
    }
    setPayerAmounts(newAmounts);
  };

  const toggleBeneficiary = (memberId: string) => {
    const newSet = new Set(selectedBeneficiaries());
    if (newSet.has(memberId)) {
      newSet.delete(memberId);
    } else {
      newSet.add(memberId);
    }
    setSelectedBeneficiaries(newSet);
  };

  const updateBeneficiaryShares = (memberId: string, delta: number) => {
    const newShares = new Map(beneficiaryShares());
    const current = newShares.get(memberId) || 1;
    const newValue = Math.max(1, current + delta);
    newShares.set(memberId, newValue);
    setBeneficiaryShares(newShares);
  };

  const updateBeneficiaryAmount = (memberId: string, value: string) => {
    const newAmounts = new Map(beneficiaryAmounts());
    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      newAmounts.set(memberId, numValue);
    } else {
      newAmounts.delete(memberId);
    }
    setBeneficiaryAmounts(newAmounts);
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!description().trim()) {
      newErrors.description = t('expenseForm.descriptionRequired');
    }

    const amountNum = parseFloat(amount());
    if (!amount() || isNaN(amountNum) || amountNum <= 0) {
      newErrors.amount = t('expenseForm.amountRequired');
    }

    // Validate default currency amount for non-default currencies
    if (isNonDefaultCurrency()) {
      const defaultAmountNum = parseFloat(defaultCurrencyAmount());
      if (!defaultCurrencyAmount() || isNaN(defaultAmountNum) || defaultAmountNum <= 0) {
        newErrors.defaultCurrencyAmount = t('expenseForm.defaultCurrencyRequired');
      }
    }

    // Validate payers
    if (multiplePayers()) {
      // Multiple payers mode
      if (selectedPayers().size === 0) {
        newErrors.payers = t('expenseForm.selectPayer');
      } else {
        const selectedPayerIds = Array.from(selectedPayers());

        // Check all payers have amounts
        for (const id of selectedPayerIds) {
          const amt = payerAmounts().get(id);
          if (amt === undefined || amt <= 0) {
            newErrors.payers = t('expenseForm.payerAmountRequired');
            break;
          }
        }

        // Validate payer amounts sum to total
        if (!newErrors.payers) {
          const totalPaid = selectedPayerIds.reduce((sum, id) => {
            return sum + (payerAmounts().get(id) || 0);
          }, 0);

          if (Math.abs(totalPaid - amountNum) > 0.01) {
            newErrors.payers = t('expenseForm.payerTotalMismatch', {
              paid: totalPaid.toFixed(2),
              amount: amountNum.toFixed(2),
            });
          }
        }
      }
    } else {
      // Single payer mode
      if (!payerId()) {
        newErrors.payer = t('expenseForm.selectPayer');
      }
    }

    if (selectedBeneficiaries().size === 0) {
      newErrors.beneficiaries = t('expenseForm.selectBeneficiary');
    }

    // Validate exact amounts sum to total
    if (splitType() === 'exact') {
      const selectedIds = Array.from(selectedBeneficiaries());
      const totalAssigned = selectedIds.reduce((sum, id) => {
        return sum + (beneficiaryAmounts().get(id) || 0);
      }, 0);

      if (Math.abs(totalAssigned - amountNum) > 0.01) {
        newErrors.beneficiaries = t('expenseForm.beneficiaryTotalMismatch', {
          assigned: totalAssigned.toFixed(2),
          amount: amountNum.toFixed(2),
        });
      }

      // Check all beneficiaries have amounts
      for (const id of selectedIds) {
        const amt = beneficiaryAmounts().get(id);
        if (!amt || amt <= 0) {
          newErrors.beneficiaries = t('expenseForm.beneficiaryAmountRequired');
          break;
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsSubmitting(true);

    try {
      const payers: Payer[] = multiplePayers()
        ? Array.from(selectedPayers()).map((memberId) => ({
            memberId,
            amount: payerAmounts().get(memberId) || 0,
          }))
        : [
            {
              memberId: payerId(),
              amount: parseFloat(amount()),
            },
          ];

      const beneficiaries: Beneficiary[] = Array.from(selectedBeneficiaries()).map((memberId) => {
        if (splitType() === 'exact') {
          return {
            memberId,
            splitType: 'exact' as SplitType,
            amount: beneficiaryAmounts().get(memberId) || 0,
          };
        } else {
          return {
            memberId,
            splitType: 'shares' as SplitType,
            shares: beneficiaryShares().get(memberId) || 1,
          };
        }
      });

      const formData: ExpenseFormData = {
        amount: parseFloat(amount()),
        description: description().trim(),
        currency: currency(),
        date: new Date(date() || Date.now()).getTime(),
        category: category() || undefined,
        location: location().trim() || undefined,
        notes: notes().trim() || undefined,
        payers,
        beneficiaries,
        defaultCurrencyAmount: isNonDefaultCurrency()
          ? parseFloat(defaultCurrencyAmount())
          : undefined,
      };

      await props.onSubmit(formData);
      props.onCancel(); // Close modal on success
    } catch (error) {
      console.error(
        isEditMode() ? 'Failed to update expense:' : 'Failed to create expense:',
        error
      );
      setErrors({
        submit: isEditMode() ? t('expenseForm.updateFailed') : t('expenseForm.createFailed'),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form class="expense-form" onSubmit={handleSubmit}>
      {/* Basic Section */}
      <div class="form-section">
        <div class="form-field">
          <label class="form-label">{t('expenseForm.description')}</label>
          <Input
            type="text"
            value={description()}
            placeholder={t('expenseForm.descriptionPlaceholder')}
            disabled={isSubmitting()}
            error={!!errors().description}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="form-label">{t('expenseForm.amount')}</label>
            <Input
              type="number"
              value={amount()}
              placeholder={t('expenseForm.amountPlaceholder')}
              step={0.01}
              min={0}
              disabled={isSubmitting()}
              error={!!errors().amount}
              onInput={(e) => setAmount(e.currentTarget.value)}
            />
          </div>

          <div class="form-field">
            <label class="form-label">{t('expenseForm.currency')}</label>
            <Select
              value={currency()}
              disabled={isSubmitting()}
              onChange={(e) => setCurrency(e.currentTarget.value)}
            >
              <For
                each={[
                  'USD',
                  'EUR',
                  'GBP',
                  'JPY',
                  'AUD',
                  'CAD',
                  'CHF',
                  'CNY',
                  'SEK',
                  'NZD',
                  'MXN',
                  'SGD',
                  'HKD',
                  'NOK',
                  'KRW',
                  'TRY',
                  'INR',
                  'RUB',
                  'BRL',
                  'ZAR',
                ]}
              >
                {(curr) => <option value={curr}>{curr}</option>}
              </For>
            </Select>
          </div>
        </div>

        {/* Currency Conversion - shown only for non-default currencies */}
        <Show when={isNonDefaultCurrency()}>
          <div class="form-field">
            <label class="form-label">
              {t('expenseForm.defaultCurrencyAmount', { currency: getDefaultCurrency() })}
            </label>
            <Input
              type="number"
              value={defaultCurrencyAmount()}
              placeholder={t('expenseForm.amountPlaceholder')}
              step={0.01}
              min={0}
              disabled={isSubmitting()}
              error={!!errors().defaultCurrencyAmount}
              onInput={(e) => setDefaultCurrencyAmount(e.currentTarget.value)}
            />
          </div>

          {/* Exchange Rate Display */}
          <Show when={exchangeRate() !== null}>
            <div class="exchange-rate-display">
              <div class="exchange-rate-label">{t('expenseForm.exchangeRate')}:</div>
              <div class="exchange-rate-values">
                <span class="exchange-rate-value">
                  1 {currency()} = {formatExchangeRate(exchangeRate())} {getDefaultCurrency()}
                </span>
                <span class="exchange-rate-separator">•</span>
                <span class="exchange-rate-value">
                  1 {getDefaultCurrency()} = {formatExchangeRate(inverseExchangeRate())}{' '}
                  {currency()}
                </span>
              </div>
            </div>
          </Show>
        </Show>

        <div class="form-field">
          <label class="form-label">{t('expenseForm.date')}</label>
          <Input
            type="date"
            value={date()}
            disabled={isSubmitting()}
            onChange={(e) => setDate(e.currentTarget.value)}
          />
        </div>
      </div>

      {/* Payer Section */}
      <div class="form-section">
        <div class="form-section-header">
          <h3 class="form-section-title">{t('expenseForm.whoPaid')}</h3>
          <button
            type="button"
            class="form-toggle-btn"
            onClick={() => setMultiplePayers(!multiplePayers())}
            disabled={isSubmitting()}
            style="font-size: var(--font-size-sm); padding: var(--space-xs) var(--space-sm);"
          >
            {multiplePayers() ? t('expenseForm.singlePayer') : t('expenseForm.multiplePayers')}
          </button>
        </div>

        <Show when={!multiplePayers()}>
          {/* Single payer mode */}
          <Select
            value={payerId()}
            disabled={isSubmitting()}
            error={errors().payer}
            onChange={(e) => setPayerId(e.currentTarget.value)}
          >
            <option value="">{t('expenseForm.selectMember')}</option>
            <For each={sortedActiveMembers()}>
              {(member) => (
                <option value={member.id}>
                  {member.id === identity()?.publicKeyHash ? t('common.you') : member.name}
                </option>
              )}
            </For>
            <Show when={sortedDepartedMembers().length > 0}>
              <optgroup label={t('expenseForm.pastMembers')}>
                <For each={sortedDepartedMembers()}>
                  {(member) => <option value={member.id}>{member.name}</option>}
                </For>
              </optgroup>
            </Show>
          </Select>
        </Show>

        <Show when={multiplePayers()}>
          {/* Multiple payers mode */}
          <div class="beneficiaries-list">
            <For each={sortedActiveMembers()}>
              {(member) => {
                const isSelected = () => selectedPayers().has(member.id);
                const memberName = () =>
                  member.id === identity()?.publicKeyHash ? t('common.you') : member.name;

                return (
                  <div class={`beneficiary-item ${isSelected() ? 'selected' : ''}`}>
                    <label class="beneficiary-checkbox">
                      <input
                        type="checkbox"
                        checked={isSelected()}
                        disabled={isSubmitting()}
                        onChange={() => togglePayer(member.id)}
                      />
                      <span>{memberName()}</span>
                    </label>

                    <Show when={isSelected()}>
                      <div class="beneficiary-control">
                        <Input
                          type="number"
                          value={(payerAmounts().get(member.id) || 0).toString()}
                          placeholder="0.00"
                          step={0.01}
                          min={0}
                          disabled={isSubmitting()}
                          onInput={(e) => updatePayerAmount(member.id, e.currentTarget.value)}
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>

            {/* Departed Members Section */}
            <Show when={sortedDepartedMembers().length > 0}>
              <div style="margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid var(--color-border);">
                <button
                  type="button"
                  class="form-toggle-btn"
                  onClick={() => setShowDepartedMembers(!showDepartedMembers())}
                  style="width: 100%; text-align: left; padding: var(--space-sm); background: var(--color-bg-secondary); border: none; border-radius: var(--border-radius); cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-light);"
                >
                  {showDepartedMembers() ? '▼' : '▶'} {t('expenseForm.pastMembers')} (
                  {sortedDepartedMembers().length})
                </button>
                <Show when={showDepartedMembers()}>
                  <div style="margin-top: var(--space-sm);">
                    <For each={sortedDepartedMembers()}>
                      {(member) => {
                        const isSelected = () => selectedPayers().has(member.id);

                        return (
                          <div class={`beneficiary-item ${isSelected() ? 'selected' : ''}`}>
                            <label class="beneficiary-checkbox">
                              <input
                                type="checkbox"
                                checked={isSelected()}
                                disabled={isSubmitting()}
                                onChange={() => togglePayer(member.id)}
                              />
                              <span>{member.name}</span>
                            </label>

                            <Show when={isSelected()}>
                              <div class="beneficiary-control">
                                <Input
                                  type="number"
                                  value={(payerAmounts().get(member.id) || 0).toString()}
                                  placeholder="0.00"
                                  step={0.01}
                                  min={0}
                                  disabled={isSubmitting()}
                                  onInput={(e) =>
                                    updatePayerAmount(member.id, e.currentTarget.value)
                                  }
                                />
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>
          </div>

          {errors().payers && <div class="form-field-error">{errors().payers}</div>}
        </Show>
      </div>

      {/* Beneficiaries Section */}
      <div class="form-section">
        <div class="form-section-header">
          <h3 class="form-section-title">{t('expenseForm.splitBetween')}</h3>
          <div class="split-type-toggle">
            <button
              type="button"
              class={`toggle-btn ${splitType() === 'shares' ? 'active' : ''}`}
              onClick={() => setSplitType('shares')}
              disabled={isSubmitting()}
            >
              {t('expenseForm.shares')}
            </button>
            <button
              type="button"
              class={`toggle-btn ${splitType() === 'exact' ? 'active' : ''}`}
              onClick={() => setSplitType('exact')}
              disabled={isSubmitting()}
            >
              {t('expenseForm.exactAmounts')}
            </button>
          </div>
        </div>

        <div class="beneficiaries-list">
          <For each={sortedActiveMembers()}>
            {(member) => {
              const isSelected = () => selectedBeneficiaries().has(member.id);
              const memberName = () =>
                member.id === identity()?.publicKeyHash ? t('common.you') : member.name;

              return (
                <div class={`beneficiary-item ${isSelected() ? 'selected' : ''}`}>
                  <label class="beneficiary-checkbox">
                    <input
                      type="checkbox"
                      checked={isSelected()}
                      disabled={isSubmitting()}
                      onChange={() => toggleBeneficiary(member.id)}
                    />
                    <span>{memberName()}</span>
                  </label>

                  <Show when={isSelected()}>
                    <Show when={splitType() === 'shares'}>
                      <div class="beneficiary-control">
                        <button
                          type="button"
                          class="control-btn"
                          onClick={() => updateBeneficiaryShares(member.id, -1)}
                          disabled={isSubmitting()}
                        >
                          −
                        </button>
                        <span class="control-value">
                          {beneficiaryShares().get(member.id) || 1}
                          <span class="control-value-label">
                            {' '}
                            {(beneficiaryShares().get(member.id) || 1) > 1
                              ? t('expenseForm.sharesLabel')
                              : t('expenseForm.shareLabel')}
                          </span>
                        </span>
                        <button
                          type="button"
                          class="control-btn"
                          onClick={() => updateBeneficiaryShares(member.id, 1)}
                          disabled={isSubmitting()}
                        >
                          +
                        </button>
                        <span class="control-amount">
                          ({currency()} {(calculatedShares().get(member.id) || 0).toFixed(2)})
                        </span>
                      </div>
                    </Show>

                    <Show when={splitType() === 'exact'}>
                      <div class="beneficiary-control">
                        <Input
                          type="number"
                          value={(beneficiaryAmounts().get(member.id) || 0).toString()}
                          placeholder="0.00"
                          step={0.01}
                          min={0}
                          disabled={isSubmitting()}
                          onInput={(e) => updateBeneficiaryAmount(member.id, e.currentTarget.value)}
                        />
                      </div>
                    </Show>
                  </Show>
                </div>
              );
            }}
          </For>

          {/* Departed Members Section */}
          <Show when={sortedDepartedMembers().length > 0}>
            <div style="margin-top: var(--space-md); padding-top: var(--space-md); border-top: 1px solid var(--color-border);">
              <button
                type="button"
                class="form-toggle-btn"
                onClick={() => setShowDepartedMembers(!showDepartedMembers())}
                style="width: 100%; text-align: left; padding: var(--space-sm); background: var(--color-bg-secondary); border: none; border-radius: var(--border-radius); cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-light);"
              >
                {showDepartedMembers() ? '▼' : '▶'} {t('expenseForm.pastMembers')} (
                {sortedDepartedMembers().length})
              </button>
              <Show when={showDepartedMembers()}>
                <div style="margin-top: var(--space-sm);">
                  <For each={sortedDepartedMembers()}>
                    {(member) => {
                      const isSelected = () => selectedBeneficiaries().has(member.id);

                      return (
                        <div class={`beneficiary-item ${isSelected() ? 'selected' : ''}`}>
                          <label class="beneficiary-checkbox">
                            <input
                              type="checkbox"
                              checked={isSelected()}
                              disabled={isSubmitting()}
                              onChange={() => toggleBeneficiary(member.id)}
                            />
                            <span>{member.name}</span>
                          </label>

                          <Show when={isSelected()}>
                            <Show when={splitType() === 'shares'}>
                              <div class="beneficiary-control">
                                <button
                                  type="button"
                                  class="control-btn"
                                  onClick={() => updateBeneficiaryShares(member.id, -1)}
                                  disabled={isSubmitting()}
                                >
                                  −
                                </button>
                                <span class="control-value">
                                  {beneficiaryShares().get(member.id) || 1}
                                </span>
                                <button
                                  type="button"
                                  class="control-btn"
                                  onClick={() => updateBeneficiaryShares(member.id, 1)}
                                  disabled={isSubmitting()}
                                >
                                  +
                                </button>
                              </div>
                            </Show>
                            <Show when={splitType() === 'exact'}>
                              <div class="beneficiary-control">
                                <input
                                  type="number"
                                  value={(beneficiaryAmounts().get(member.id) || 0).toString()}
                                  placeholder="0.00"
                                  step={0.01}
                                  min={0}
                                  disabled={isSubmitting()}
                                  onInput={(e) =>
                                    updateBeneficiaryAmount(member.id, e.currentTarget.value)
                                  }
                                />
                              </div>
                            </Show>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {errors().beneficiaries && <div class="form-field-error">{errors().beneficiaries}</div>}
      </div>

      {/* Advanced Section */}
      <div class="form-section">
        <button
          type="button"
          class="form-toggle-btn"
          onClick={() => setShowAdvanced(!showAdvanced())}
        >
          {showAdvanced() ? '▼' : '▶'} {t('expenseForm.advancedOptions')}
        </button>

        <Show when={showAdvanced()}>
          <div class="form-field">
            <label class="form-label">{t('expenseForm.category')}</label>
            <Select
              value={category()}
              disabled={isSubmitting()}
              onChange={(e) => setCategory(e.currentTarget.value as ExpenseCategory)}
            >
              <option value="">{t('expenseForm.selectCategory')}</option>
              <For each={CATEGORIES}>
                {(cat) => (
                  <option value={cat.value}>
                    {cat.emoji} {t(cat.labelKey)}
                  </option>
                )}
              </For>
            </Select>
          </div>

          <div class="form-field">
            <label class="form-label">{t('expenseForm.location')}</label>
            <Input
              type="text"
              value={location()}
              placeholder={t('expenseForm.locationPlaceholder')}
              disabled={isSubmitting()}
              onInput={(e) => setLocation(e.currentTarget.value)}
            />
          </div>

          <div class="form-field">
            <label class="form-label">{t('expenseForm.notes')}</label>
            <textarea
              class="form-textarea"
              value={notes()}
              placeholder={t('expenseForm.notesPlaceholder')}
              rows={3}
              disabled={isSubmitting()}
              onInput={(e) => setNotes(e.currentTarget.value)}
            />
          </div>
        </Show>
      </div>

      {errors().submit && <div class="form-error">{errors().submit}</div>}

      <div class="form-actions">
        <Button
          type="button"
          variant="secondary"
          onClick={props.onCancel}
          disabled={isSubmitting()}
        >
          {t('common.cancel')}
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting()}>
          {isSubmitting()
            ? isEditMode()
              ? t('expenseForm.saving')
              : t('expenseForm.creating')
            : isEditMode()
              ? t('expenseForm.saveButton')
              : t('expenseForm.createButton')}
        </Button>
      </div>
    </form>
  );
};
