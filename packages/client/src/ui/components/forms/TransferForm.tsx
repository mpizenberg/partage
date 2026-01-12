import { Component, createSignal, For, Show, createMemo } from 'solid-js'
import { useAppContext } from '../../context/AppContext'
import { Input } from '../common/Input'
import { Select } from '../common/Select'
import { Button } from '../common/Button'
import type { TransferFormData, FormErrors } from './types'
import type { TransferEntry } from '@partage/shared'

export interface TransferInitialData {
  from?: string
  to?: string
  amount?: number
  currency?: string
}

export interface TransferFormProps {
  onSubmit: (data: TransferFormData) => Promise<void>
  onCancel: () => void
  initialData?: TransferEntry | TransferInitialData
}

export const TransferForm: Component<TransferFormProps> = (props) => {
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

  const formatDateForInput = (timestamp: number): string => {
    return new Date(timestamp).toISOString().split('T')[0] || ''
  }

  // Check if we're in edit mode (initialData is a full TransferEntry with id)
  const isEditMode = () => !!(props.initialData && 'id' in props.initialData)

  // Helper to check if initialData has a specific field
  const getInitialValue = <K extends keyof TransferEntry>(key: K, defaultValue: any): any => {
    if (!props.initialData) return defaultValue
    return (props.initialData as any)[key] ?? defaultValue
  }

  // Initialize signals from initialData if present
  const [amount, setAmount] = createSignal(
    getInitialValue('amount', 0) ? getInitialValue('amount', '').toString() : ''
  )
  const [currency, setCurrency] = createSignal(
    getInitialValue('currency', activeGroup()?.defaultCurrency || 'USD')
  )
  const [defaultCurrencyAmount, setDefaultCurrencyAmount] = createSignal(
    getInitialValue('defaultCurrencyAmount', null)?.toString() || ''
  )
  const [from, setFrom] = createSignal(getInitialValue('from', ''))
  const [to, setTo] = createSignal(getInitialValue('to', ''))
  const [date, setDate] = createSignal(
    props.initialData && 'date' in props.initialData
      ? formatDateForInput(props.initialData.date)
      : new Date().toISOString().split('T')[0]
  )
  const [notes, setNotes] = createSignal(getInitialValue('notes', ''))
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

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

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

    if (!from()) {
      newErrors.from = 'Please select who is sending the transfer'
    }

    if (!to()) {
      newErrors.to = 'Please select who is receiving the transfer'
    }

    if (from() && to() && from() === to()) {
      newErrors.to = 'Sender and receiver must be different'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()

    if (!validateForm()) return

    setIsSubmitting(true)

    try {
      const formData: TransferFormData = {
        amount: parseFloat(amount()),
        currency: currency(),
        from: from(),
        to: to(),
        date: new Date(date() || Date.now()).getTime(),
        notes: notes() || undefined,
        defaultCurrencyAmount: isNonDefaultCurrency()
          ? parseFloat(defaultCurrencyAmount())
          : undefined,
      }

      await props.onSubmit(formData)
      props.onCancel() // Close modal on success
    } catch (error) {
      console.error(isEditMode() ? 'Failed to update transfer:' : 'Failed to create transfer:', error)
      setErrors({ submit: isEditMode() ? 'Failed to update transfer. Please try again.' : 'Failed to create transfer. Please try again.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form class="transfer-form" onSubmit={handleSubmit}>
      <div class="form-section">
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

        <div class="form-row">
          <div class="form-field">
            <label class="form-label">From</label>
            <Select
              value={from()}
              disabled={isSubmitting()}
              error={errors().from}
              onChange={(e) => setFrom(e.currentTarget.value)}
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

          <div class="form-field">
            <label class="form-label">To</label>
            <Select
              value={to()}
              disabled={isSubmitting()}
              error={errors().to}
              onChange={(e) => setTo(e.currentTarget.value)}
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

        <div class="form-field">
          <label class="form-label">Notes (optional)</label>
          <textarea
            class="form-textarea"
            value={notes()}
            placeholder="Add a note..."
            rows={3}
            disabled={isSubmitting()}
            onInput={(e) => setNotes(e.currentTarget.value)}
          />
        </div>
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
            : (isEditMode() ? 'Save Changes' : 'Create Transfer')
          }
        </Button>
      </div>
    </form>
  )
}
