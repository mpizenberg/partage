import { Component, createSignal, For, Show, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Button } from '../common/Button'
import type { ExpenseFormData, FormErrors } from './types'
import type { ExpenseCategory, SplitType, Payer, Beneficiary } from '@partage/shared'

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
}

export const ExpenseForm: Component<ExpenseFormProps> = (props) => {
  const { members, activeGroup, identity } = useAppContext()

  // Basic fields
  const [amount, setAmount] = createSignal('')
  const [description, setDescription] = createSignal('')
  const [currency, setCurrency] = createSignal(activeGroup()?.defaultCurrency || 'USD')
  const [date, setDate] = createSignal(new Date().toISOString().split('T')[0])
  const [category, setCategory] = createSignal<ExpenseCategory | ''>('')
  const [location, setLocation] = createSignal('')
  const [notes, setNotes] = createSignal('')
  const [showAdvanced, setShowAdvanced] = createSignal(false)

  // Payers: Default to current user paying full amount
  const [payerId, setPayerId] = createSignal(identity()?.publicKeyHash || '')

  // Beneficiaries: Track selected members and their shares/amounts
  const [selectedBeneficiaries, setSelectedBeneficiaries] = createSignal<Set<string>>(
    new Set([identity()?.publicKeyHash || ''])
  )
  const [splitType, setSplitType] = createSignal<SplitType>('shares')
  const [beneficiaryShares, setBeneficiaryShares] = createSignal<Map<string, number>>(new Map())
  const [beneficiaryAmounts, setBeneficiaryAmounts] = createSignal<Map<string, number>>(new Map())

  const [errors, setErrors] = createSignal<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = createSignal(false)

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
      }

      await props.onSubmit(formData)
      props.onCancel() // Close modal on success
    } catch (error) {
      console.error('Failed to create expense:', error)
      setErrors({ submit: 'Failed to create expense. Please try again.' })
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
          <For each={members()}>
            {(member) => (
              <option value={member.id}>
                {member.id === identity()?.publicKeyHash ? 'You' : member.name}
              </option>
            )}
          </For>
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
          <For each={members()}>
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
                          {beneficiaryShares().get(member.id) || 1} share{(beneficiaryShares().get(member.id) || 1) > 1 ? 's' : ''}
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
          {isSubmitting() ? 'Creating...' : 'Create Expense'}
        </Button>
      </div>
    </form>
  )
}
