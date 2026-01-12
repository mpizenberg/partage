import { Component, createSignal, For, Show, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Button } from '../common/Button'
import type { ExpenseFormData, FormErrors } from './types'
import type { ExpenseCategory, SplitType, Payer, Beneficiary, ExpenseEntry } from '@partage/shared'

const CATEGORIES: { value: ExpenseCategory; label: string; emoji: string }[] = [
  { value: 'food', label: 'Food', emoji: '🍔' },
  { value: 'transport', label: 'Transport', emoji: '🚗' },
  { value: 'accommodation', label: 'Accommodation', emoji: '🏨' },
  { value: 'entertainment', label: 'Entertainment', emoji: '🎬' },
  { value: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { value: 'groceries', label: 'Groceries', emoji: '🛒' },
  { value: 'utilities', label: 'Utilities', emoji: '💡' },
  { value: 'healthcare', label: 'Healthcare', emoji: '⚕️' },
  { value: 'other', label: 'Other', emoji: '📝' },
]

export interface ExpenseFormProps {
  onSubmit: (data: ExpenseFormData) => Promise<void>
  onCancel: () => void
  initialData?: ExpenseEntry
}

export const ExpenseForm: Component<ExpenseFormProps> = (props) => {
  const { members, activeGroup, identity } = useAppContext()

  // Sorted active members: current user first, then others alphabetically (case-insensitive)
  const sortedActiveMembers = createMemo(() => {
    const currentUserId = identity()?.publicKeyHash
    const membersList = members().filter(m => m.status === 'active')

    const currentUser = membersList.filter(m => m.id === currentUserId)
    const others = membersList
      .filter(m => m.id !== currentUserId)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))

    return [...currentUser, ...others]
  })

  // Sorted departed members (alphabetically)
  const sortedDepartedMembers = createMemo(() => {
    return members()
      .filter(m => m.status === 'departed')
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
  })

  const [showDepartedMembers, setShowDepartedMembers] = createSignal(false)

  // Helper functions to extract initial data
  const getInitialBeneficiaries = (): Set<string> => {
    if (!props.initialData) {
      return new Set([identity()?.publicKeyHash || ''])
    }
    return new Set(props.initialData.beneficiaries.map(b => b.memberId))
  }

  const getInitialSplitType = (): SplitType => {
    if (!props.initialData || props.initialData.beneficiaries.length === 0) {
      return 'shares'
    }
    return props.initialData.beneficiaries[0]?.splitType || 'shares'
  }

  const getInitialShares = (): Map<string, number> => {
    const map = new Map<string, number>()
    if (props.initialData) {
      props.initialData.beneficiaries.forEach(b => {
        if (b.splitType === 'shares' && b.shares !== undefined) {
          map.set(b.memberId, b.shares)
        }
      })
    }
    return map
  }

  const getInitialAmounts = (): Map<string, number> => {
    const map = new Map<string, number>()
    if (props.initialData) {
      props.initialData.beneficiaries.forEach(b => {
        if (b.splitType === 'exact' && b.amount !== undefined) {
          map.set(b.memberId, b.amount)
        }
      })
    }
    return map
  }

  const formatDateForInput = (timestamp: number): string => {
    return new Date(timestamp).toISOString().split('T')[0] || ''
  }

  // Basic fields - initialized from props.initialData if present
  const [amount, setAmount] = createSignal(props.initialData?.amount.toString() || '')
  const [description, setDescription] = createSignal(props.initialData?.description || '')
  const [currency, setCurrency] = createSignal(props.initialData?.currency || activeGroup()?.defaultCurrency || 'USD')
  const [defaultCurrencyAmount, setDefaultCurrencyAmount] = createSignal(
    props.initialData?.defaultCurrencyAmount?.toString() || ''
  )
  const [date, setDate] = createSignal(
    props.initialData ? formatDateForInput(props.initialData.date) : new Date().toISOString().split('T')[0]
  )
  const [category, setCategory] = createSignal<ExpenseCategory | ''>(props.initialData?.category || '')
  const [location, setLocation] = createSignal(props.initialData?.location || '')
  const [notes, setNotes] = createSignal(props.initialData?.notes || '')
  const [showAdvanced, setShowAdvanced] = createSignal(
    !!(props.initialData?.category || props.initialData?.location || props.initialData?.notes)
  )

  // Payers: Default to current user paying full amount, or use initial data
  const [payerId, setPayerId] = createSignal(
    props.initialData?.payers[0]?.memberId || identity()?.publicKeyHash || ''
  )

  // Beneficiaries: Track selected members and their shares/amounts
  const [selectedBeneficiaries, setSelectedBeneficiaries] = createSignal<Set<string>>(getInitialBeneficiaries())
  const [splitType, setSplitType] = createSignal<SplitType>(getInitialSplitType())
  const [beneficiaryShares, setBeneficiaryShares] = createSignal<Map<string, number>>(getInitialShares())
  const [beneficiaryAmounts, setBeneficiaryAmounts] = createSignal<Map<string, number>>(getInitialAmounts())

  // Check if we're in edit mode
  const isEditMode = () => !!props.initialData

  const [errors, setErrors] = createSignal<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = createSignal(false)

  // Check if currency is different from default
  const isNonDefaultCurrency = createMemo(() => {
    const defaultCurrency = activeGroup()?.defaultCurrency || 'USD'
    return currency() !== defaultCurrency
  })

  // Get default currency
  const getDefaultCurrency = () => {
    return activeGroup()?.defaultCurrency || 'USD'
  }

  // Calculate exchange rate (original to default)
  const exchangeRate = createMemo(() => {
    const amountNum = parseFloat(amount())
    const defaultAmountNum = parseFloat(defaultCurrencyAmount())

    if (isNaN(amountNum) || isNaN(defaultAmountNum) || amountNum === 0) {
      return null
    }

    return defaultAmountNum / amountNum
  })

  // Calculate inverse exchange rate (default to original)
  const inverseExchangeRate = createMemo(() => {
    const rate = exchangeRate()
    if (!rate || rate === 0) return null
    return 1 / rate
  })

  // Format exchange rate display
  const formatExchangeRate = (rate: number | null): string => {
    if (!rate) return ''
    return rate.toFixed(3)
  }

  // Calculate shares for display
  const calculatedShares = createMemo(() => {
    const amountNum = parseFloat(amount())
    if (isNaN(amountNum) || amountNum <= 0) return new Map<string, number>()

    if (splitType() === 'exact') {
      return beneficiaryAmounts()
    }

    // Calculate from shares
    const shares = beneficiaryShares()
    const selectedIds = Array.from(selectedBeneficiaries())
    const totalShares = selectedIds.reduce((sum, id) => sum + (shares.get(id) || 1), 0)

    const result = new Map<string, number>()
    selectedIds.forEach((id) => {
      const memberShares = shares.get(id) || 1
      result.set(id, (amountNum * memberShares) / totalShares)
    })
    return result
  })

  const toggleBeneficiary = (memberId: string) => {
    const newSet = new Set(selectedBeneficiaries())
    if (newSet.has(memberId)) {
      newSet.delete(memberId)
    } else {
      newSet.add(memberId)
    }
    setSelectedBeneficiaries(newSet)
  }

  const updateBeneficiaryShares = (memberId: string, delta: number) => {
    const newShares = new Map(beneficiaryShares())
    const current = newShares.get(memberId) || 1
    const newValue = Math.max(1, current + delta)
    newShares.set(memberId, newValue)
    setBeneficiaryShares(newShares)
  }

  const updateBeneficiaryAmount = (memberId: string, value: string) => {
    const newAmounts = new Map(beneficiaryAmounts())
    const numValue = parseFloat(value)
    if (!isNaN(numValue) && numValue >= 0) {
      newAmounts.set(memberId, numValue)
    } else {
      newAmounts.delete(memberId)
    }
    setBeneficiaryAmounts(newAmounts)
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!description().trim()) {
      newErrors.description = 'Description is required'
    }

    const amountNum = parseFloat(amount())
    if (!amount() || isNaN(amountNum) || amountNum <= 0) {
      newErrors.amount = 'Amount must be greater than 0'
    }

    // Validate default currency amount for non-default currencies
    if (isNonDefaultCurrency()) {
      const defaultAmountNum = parseFloat(defaultCurrencyAmount())
      if (!defaultCurrencyAmount() || isNaN(defaultAmountNum) || defaultAmountNum <= 0) {
        newErrors.defaultCurrencyAmount = 'Default currency amount is required'
      }
    }

    if (!payerId()) {
      newErrors.payer = 'Please select who paid'
    }

    if (selectedBeneficiaries().size === 0) {
      newErrors.beneficiaries = 'Please select at least one beneficiary'
    }

    // Validate exact amounts sum to total
    if (splitType() === 'exact') {
      const selectedIds = Array.from(selectedBeneficiaries())
      const totalAssigned = selectedIds.reduce((sum, id) => {
        return sum + (beneficiaryAmounts().get(id) || 0)
      }, 0)

      if (Math.abs(totalAssigned - amountNum) > 0.01) {
        newErrors.beneficiaries = `Total assigned (${totalAssigned.toFixed(2)}) must equal expense amount (${amountNum.toFixed(2)})`
      }

      // Check all beneficiaries have amounts
      for (const id of selectedIds) {
        const amt = beneficiaryAmounts().get(id)
        if (!amt || amt <= 0) {
          newErrors.beneficiaries = 'All beneficiaries must have a valid amount'
          break
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsSubmitting(true)

    try {
      const payers: Payer[] = [
        {
          memberId: payerId(),
          amount: parseFloat(amount()),
        },
      ]

      const beneficiaries: Beneficiary[] = Array.from(selectedBeneficiaries()).map((memberId) => {
        if (splitType() === 'exact') {
          return {
            memberId,
            splitType: 'exact' as SplitType,
            amount: beneficiaryAmounts().get(memberId) || 0,
          }
        } else {
          return {
            memberId,
            splitType: 'shares' as SplitType,
            shares: beneficiaryShares().get(memberId) || 1,
          }
        }
      })

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
      }

      await props.onSubmit(formData)
      props.onCancel() // Close modal on success
    } catch (error) {
      console.error(isEditMode() ? 'Failed to update expense:' : 'Failed to create expense:', error)
      setErrors({ submit: isEditMode() ? 'Failed to update expense. Please try again.' : 'Failed to create expense. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form class="expense-form" onSubmit={handleSubmit}>
      {/* Basic Section */}
      <div class="form-section">
        <div class="form-field">
          <label class="form-label">Description</label>
          <Input
            type="text"
            value={description()}
            placeholder="What was this expense for?"
            disabled={isSubmitting()}
            error={!!errors().description}
            onInput={(e) => setDescription(e.currentTarget.value)}
          />
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="form-label">Amount</label>
            <Input
              type="number"
              value={amount()}
              placeholder="0.00"
              step={0.01}
              min={0}
              disabled={isSubmitting()}
              error={!!errors().amount}
              onInput={(e) => setAmount(e.currentTarget.value)}
            />
          </div>

          <div class="form-field">
            <label class="form-label">Currency</label>
            <Select
              value={currency()}
              disabled={isSubmitting()}
              onChange={(e) => setCurrency(e.currentTarget.value)}
            >
              <For each={['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD', 'MXN', 'SGD', 'HKD', 'NOK', 'KRW', 'TRY', 'INR', 'RUB', 'BRL', 'ZAR']}>
                {(curr) => <option value={curr}>{curr}</option>}
              </For>
            </Select>
          </div>
        </div>

        {/* Currency Conversion - shown only for non-default currencies */}
        <Show when={isNonDefaultCurrency()}>
          <div class="form-field">
            <label class="form-label">
              Amount in {getDefaultCurrency()} (default currency)
            </label>
            <Input
              type="number"
              value={defaultCurrencyAmount()}
              placeholder="0.00"
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
              <div class="exchange-rate-label">Exchange rates:</div>
              <div class="exchange-rate-values">
                <span class="exchange-rate-value">
                  1 {currency()} = {formatExchangeRate(exchangeRate())} {getDefaultCurrency()}
                </span>
                <span class="exchange-rate-separator">•</span>
                <span class="exchange-rate-value">
                  1 {getDefaultCurrency()} = {formatExchangeRate(inverseExchangeRate())} {currency()}
                </span>
              </div>
            </div>
          </Show>
        </Show>

        <div class="form-field">
          <label class="form-label">Date</label>
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
        <h3 class="form-section-title">Who Paid?</h3>
        <Select
          value={payerId()}
          disabled={isSubmitting()}
          error={errors().payer}
          onChange={(e) => setPayerId(e.currentTarget.value)}
        >
          <option value="">Select member</option>
          <For each={sortedActiveMembers()}>
            {(member) => (
              <option value={member.id}>
                {member.id === identity()?.publicKeyHash ? 'You' : member.name}
              </option>
            )}
          </For>
          <Show when={sortedDepartedMembers().length > 0}>
            <optgroup label="Past members">
              <For each={sortedDepartedMembers()}>
                {(member) => (
                  <option value={member.id}>
                    {member.name}
                  </option>
                )}
              </For>
            </optgroup>
          </Show>
        </Select>
      </div>

      {/* Beneficiaries Section */}
      <div class="form-section">
        <div class="form-section-header">
          <h3 class="form-section-title">Split Between</h3>
          <div class="split-type-toggle">
            <button
              type="button"
              class={`toggle-btn ${splitType() === 'shares' ? 'active' : ''}`}
              onClick={() => setSplitType('shares')}
              disabled={isSubmitting()}
            >
              Shares
            </button>
            <button
              type="button"
              class={`toggle-btn ${splitType() === 'exact' ? 'active' : ''}`}
              onClick={() => setSplitType('exact')}
              disabled={isSubmitting()}
            >
              Exact
            </button>
          </div>
        </div>

        <div class="beneficiaries-list">
          <For each={sortedActiveMembers()}>
            {(member) => {
              const isSelected = () => selectedBeneficiaries().has(member.id)
              const memberName = () => member.id === identity()?.publicKeyHash ? 'You' : member.name

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
                          {beneficiaryShares().get(member.id) || 1}<span class="control-value-label"> share{(beneficiaryShares().get(member.id) || 1) > 1 ? 's' : ''}</span>
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
              )
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
                {showDepartedMembers() ? '▼' : '▶'} Past members ({sortedDepartedMembers().length})
              </button>
              <Show when={showDepartedMembers()}>
                <div style="margin-top: var(--space-sm);">
                  <For each={sortedDepartedMembers()}>
                    {(member) => {
                      const isSelected = () => selectedBeneficiaries().has(member.id)

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
                                  onInput={(e) => updateBeneficiaryAmount(member.id, e.currentTarget.value)}
                                />
                              </div>
                            </Show>
                          </Show>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </div>

        {errors().beneficiaries && (
          <div class="form-field-error">{errors().beneficiaries}</div>
        )}
      </div>

      {/* Advanced Section */}
      <div class="form-section">
        <button
          type="button"
          class="form-toggle-btn"
          onClick={() => setShowAdvanced(!showAdvanced())}
        >
          {showAdvanced() ? '▼' : '▶'} Advanced Options
        </button>

        <Show when={showAdvanced()}>
          <div class="form-field">
            <label class="form-label">Category</label>
            <Select
              value={category()}
              disabled={isSubmitting()}
              onChange={(e) => setCategory(e.currentTarget.value as ExpenseCategory)}
            >
              <option value="">Select category</option>
              <For each={CATEGORIES}>
                {(cat) => (
                  <option value={cat.value}>
                    {cat.emoji} {cat.label}
                  </option>
                )}
              </For>
            </Select>
          </div>

          <div class="form-field">
            <label class="form-label">Location</label>
            <Input
              type="text"
              value={location()}
              placeholder="Where was this?"
              disabled={isSubmitting()}
              onInput={(e) => setLocation(e.currentTarget.value)}
            />
          </div>

          <div class="form-field">
            <label class="form-label">Notes</label>
            <textarea
              class="form-textarea"
              value={notes()}
              placeholder="Add any additional notes..."
              rows={3}
              disabled={isSubmitting()}
              onInput={(e) => setNotes(e.currentTarget.value)}
            />
          </div>
        </Show>
      </div>

      {errors().submit && (
        <div class="form-error">{errors().submit}</div>
      )}

      <div class="form-actions">
        <Button type="button" variant="secondary" onClick={props.onCancel} disabled={isSubmitting()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting()}>
          {isSubmitting()
            ? (isEditMode() ? 'Saving...' : 'Creating...')
            : (isEditMode() ? 'Save Changes' : 'Create Expense')
          }
        </Button>
      </div>
    </form>
  )
}
