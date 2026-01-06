import { Component, createSignal, Show } from 'solid-js'
import { useAppContext } from '../context/AppContext'
import { Input } from '../components/common/Input'
import { Select, SelectOption } from '../components/common/Select'
import { Button } from '../components/common/Button'
import { MemberManager } from '../components/forms/MemberManager'
import { LoadingSpinner } from '../components/common/LoadingSpinner'
import type { Member } from '@partage/shared'

// Predefined currency list
const CURRENCIES: SelectOption[] = [
  { value: 'USD', label: 'USD - US Dollar' },
  { value: 'EUR', label: 'EUR - Euro' },
  { value: 'GBP', label: 'GBP - British Pound' },
  { value: 'JPY', label: 'JPY - Japanese Yen' },
  { value: 'AUD', label: 'AUD - Australian Dollar' },
  { value: 'CAD', label: 'CAD - Canadian Dollar' },
  { value: 'CHF', label: 'CHF - Swiss Franc' },
  { value: 'CNY', label: 'CNY - Chinese Yuan' },
  { value: 'SEK', label: 'SEK - Swedish Krona' },
  { value: 'NZD', label: 'NZD - New Zealand Dollar' },
  { value: 'MXN', label: 'MXN - Mexican Peso' },
  { value: 'SGD', label: 'SGD - Singapore Dollar' },
  { value: 'HKD', label: 'HKD - Hong Kong Dollar' },
  { value: 'NOK', label: 'NOK - Norwegian Krone' },
  { value: 'KRW', label: 'KRW - South Korean Won' },
  { value: 'TRY', label: 'TRY - Turkish Lira' },
  { value: 'INR', label: 'INR - Indian Rupee' },
  { value: 'RUB', label: 'RUB - Russian Ruble' },
  { value: 'BRL', label: 'BRL - Brazilian Real' },
  { value: 'ZAR', label: 'ZAR - South African Rand' },
]

export interface CreateGroupScreenProps {
  onCancel: () => void
}

export const CreateGroupScreen: Component<CreateGroupScreenProps> = (props) => {
  const { identity, createGroup, isLoading, error, clearError } = useAppContext()

  // Form state
  const [groupName, setGroupName] = createSignal('')
  const [currency, setCurrency] = createSignal('USD')
  const [members, setMembers] = createSignal<Member[]>([])
  const [validationError, setValidationError] = createSignal<string | null>(null)

  // Initialize with current user
  const currentUser = (): Member => ({
    id: identity()?.publicKeyHash || '',
    name: 'You',
    publicKey: identity()?.publicKey || '',
    joinedAt: Date.now(),
    status: 'active',
    isVirtual: false,
  })

  // Get all members (current user + virtual members)
  const allMembers = () => [currentUser(), ...members()]

  const handleAddMember = (name: string) => {
    const newMember: Member = {
      id: crypto.randomUUID(),
      name,
      joinedAt: Date.now(),
      status: 'active',
      isVirtual: true,
      addedBy: identity()?.publicKeyHash,
    }
    setMembers([...members(), newMember])
  }

  const handleRemoveMember = (id: string) => {
    setMembers(members().filter(m => m.id !== id))
  }

  const validate = (): boolean => {
    clearError()
    setValidationError(null)

    if (!groupName().trim()) {
      setValidationError('Group name is required')
      return false
    }

    if (!currency()) {
      setValidationError('Please select a currency')
      return false
    }

    return true
  }

  const handleSubmit = async (e: Event) => {
    e.preventDefault()
    console.log('[CreateGroupScreen] Form submitted')
    console.log('[CreateGroupScreen] Virtual members:', members())

    if (!validate()) {
      console.log('[CreateGroupScreen] Validation failed')
      return
    }

    try {
      console.log('[CreateGroupScreen] Calling createGroup...')
      // Pass only virtual members - AppContext will add current user
      await createGroup(groupName().trim(), currency(), members())
      console.log('[CreateGroupScreen] Group created successfully')
      // Group created successfully - App will navigate to GroupViewScreen
    } catch (err) {
      console.error('[CreateGroupScreen] Failed to create group:', err)
      // Error is already set in context
    }
  }

  return (
    <div class="container">
      <div class="create-group-screen" style="max-width: 600px; margin: 0 auto; padding-top: var(--space-xl);">
        <div class="mb-lg">
          <h1 class="text-2xl font-bold mb-sm">Create a Group</h1>
          <p class="text-base text-muted">
            Set up a new group to track shared expenses
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div class="card mb-lg">
            {/* Group name */}
            <div class="form-group">
              <label class="form-label" for="group-name">
                Group Name *
              </label>
              <Input
                id="group-name"
                type="text"
                value={groupName()}
                placeholder="e.g., Weekend Trip, Apartment 42"
                onInput={(e) => {
                  setGroupName(e.currentTarget.value)
                  setValidationError(null)
                }}
                required
                error={!groupName().trim() && !!validationError()}
              />
            </div>

            {/* Currency */}
            <div class="form-group">
              <label class="form-label" for="currency">
                Default Currency *
              </label>
              <Select
                id="currency"
                value={currency()}
                options={CURRENCIES}
                onChange={(e) => setCurrency(e.currentTarget.value)}
                required
              />
              <p class="form-hint">
                All balances will be calculated in this currency
              </p>
            </div>
          </div>

          {/* Members */}
          <div class="card mb-lg">
            <MemberManager
              currentUserName="You"
              currentUserId={identity()?.publicKeyHash || ''}
              members={allMembers()}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
            />
          </div>

          {/* Errors */}
          <Show when={validationError() || error()}>
            <div class="error-message mb-md">
              {validationError() || error()}
            </div>
          </Show>

          {/* Actions */}
          <div class="flex gap-sm">
            <Button
              type="button"
              variant="secondary"
              onClick={props.onCancel}
              disabled={isLoading()}
              class="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isLoading()}
              class="flex-1"
            >
              <Show when={isLoading()} fallback="Create Group">
                <LoadingSpinner size="small" />
              </Show>
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
