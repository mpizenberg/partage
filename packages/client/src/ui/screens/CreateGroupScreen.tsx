import { Component, createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useI18n } from '../../i18n';
import { useAppContext } from '../context/AppContext';
import { Input } from '../components/common/Input';
import { Select, SelectOption } from '../components/common/Select';
import { Button } from '../components/common/Button';
import { MemberManager } from '../components/forms/MemberManager';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { pbClient } from '../../api';
import { solvePoWChallenge } from '../../core/pow/proof-of-work';
import type { Member } from '@partage/shared';

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
];

export interface CreateGroupScreenProps {
  onCancel: () => void;
}

export const CreateGroupScreen: Component<CreateGroupScreenProps> = (props) => {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const { identity, createGroup, activeGroup, isLoading, error, clearError } = useAppContext();

  // Pre-select currency based on language
  const getDefaultCurrency = (): string => {
    return locale() === 'fr' ? 'EUR' : 'USD';
  };

  // Form state
  const [groupName, setGroupName] = createSignal('');
  const [currency, setCurrency] = createSignal(getDefaultCurrency());
  const [myName, setMyName] = createSignal('');
  const [members, setMembers] = createSignal<Member[]>([]);
  const [validationError, setValidationError] = createSignal<string | null>(null);

  // PoW state
  const [isSolvingPoW, setIsSolvingPoW] = createSignal(false);
  const [powProgress, setPowProgress] = createSignal<{ hashes: number; rate: number } | null>(null);

  // Initialize with current user
  const currentUser = (): Member => ({
    id: identity()?.publicKeyHash || '',
    name: myName(),
    publicKey: identity()?.publicKey || '',
    joinedAt: Date.now(),
    status: 'active',
    isVirtual: false,
  });

  // Get all members (current user + virtual members)
  const allMembers = () => [currentUser(), ...members()];

  const handleAddMember = (name: string) => {
    const newMember: Member = {
      id: crypto.randomUUID(),
      name,
      joinedAt: Date.now(),
      status: 'active',
      isVirtual: true,
      addedBy: identity()?.publicKeyHash,
    };
    setMembers([...members(), newMember]);
  };

  const handleRemoveMember = (id: string) => {
    setMembers(members().filter((m) => m.id !== id));
  };

  const validate = (): boolean => {
    clearError();
    setValidationError(null);

    if (!groupName().trim()) {
      setValidationError(t('createGroup.groupNameRequired'));
      return false;
    }

    if (!myName().trim()) {
      setValidationError(t('createGroup.yourNameRequired'));
      return false;
    }

    if (!currency()) {
      setValidationError(t('createGroup.selectCurrency'));
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    try {
      // Step 1: Get and solve PoW challenge
      setIsSolvingPoW(true);
      setPowProgress(null);

      const challenge = await pbClient.getPoWChallenge();

      const powSolution = await solvePoWChallenge(challenge, (hashes, rate) => {
        setPowProgress({ hashes, rate });
      });

      setIsSolvingPoW(false);
      setPowProgress(null);

      // Step 2: Create the group with PoW solution
      // Pass only virtual members - AppContext will add current user
      await createGroup(groupName().trim(), currency(), members(), powSolution, myName().trim());

      // Navigate to the newly created group
      const group = activeGroup();
      if (group) {
        navigate(`/groups/${group.id}`);
      } else {
        // Fallback to home if group not found
        navigate('/');
      }
    } catch (err) {
      console.error('[CreateGroupScreen] Failed to create group:', err);
      setIsSolvingPoW(false);
      setPowProgress(null);
      // Error is already set in context
    }
  };

  // Check if form is currently submitting
  const isSubmitting = () => isSolvingPoW() || isLoading();

  return (
    <div class="container">
      <div
        class="create-group-screen"
        style="max-width: 600px; margin: 0 auto; padding-top: var(--space-xl);"
      >
        <div class="mb-lg">
          <h1 class="text-2xl font-bold mb-sm">{t('createGroup.title')}</h1>
          <p class="text-base text-muted">{t('createGroup.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div class="card mb-lg">
            {/* Group name */}
            <div class="form-group">
              <label class="form-label" for="group-name">
                {t('createGroup.groupName')} *
              </label>
              <Input
                id="group-name"
                type="text"
                value={groupName()}
                placeholder={t('createGroup.groupNamePlaceholder')}
                onInput={(e) => {
                  setGroupName(e.currentTarget.value);
                  setValidationError(null);
                }}
                required
                error={!groupName().trim() && !!validationError()}
              />
            </div>

            {/* My name */}
            <div class="form-group">
              <label class="form-label" for="my-name">
                {t('createGroup.yourName')} *
              </label>
              <Input
                id="my-name"
                type="text"
                value={myName()}
                placeholder={t('createGroup.yourNamePlaceholder')}
                onInput={(e) => {
                  setMyName(e.currentTarget.value);
                  setValidationError(null);
                }}
                required
              />
            </div>

            {/* Currency */}
            <div class="form-group">
              <label class="form-label" for="currency">
                {t('createGroup.defaultCurrency')} *
              </label>
              <Select
                id="currency"
                value={currency()}
                options={CURRENCIES}
                onChange={(e) => setCurrency(e.currentTarget.value)}
                required
              />
              <p class="form-hint">{t('createGroup.currencyHint')}</p>
            </div>
          </div>

          {/* Members */}
          <div class="card mb-lg">
            <MemberManager
              currentUserName={myName()}
              currentUserId={identity()?.publicKeyHash || ''}
              members={allMembers()}
              onAddMember={handleAddMember}
              onRemoveMember={handleRemoveMember}
            />
          </div>

          {/* PoW Progress */}
          <Show when={isSolvingPoW()}>
            <div class="info-message mb-md">
              <div class="flex items-center gap-sm">
                <LoadingSpinner size="small" />
                <span>{t('createGroup.solvingPoW')}</span>
              </div>
              <Show when={powProgress()}>
                <p class="text-sm text-muted mt-xs">
                  {t('createGroup.powProgress', {
                    hashes: (powProgress()?.hashes || 0).toLocaleString(),
                    rate: (powProgress()?.rate || 0).toLocaleString(),
                  })}
                </p>
              </Show>
            </div>
          </Show>

          {/* Errors */}
          <Show when={validationError() || error()}>
            <div class="error-message mb-md">{validationError() || error()}</div>
          </Show>

          {/* Actions */}
          <div class="flex gap-sm">
            <Button
              type="button"
              variant="secondary"
              onClick={props.onCancel}
              disabled={isSubmitting()}
              class="flex-1"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting() || !groupName().trim() || !myName().trim()}
              class="flex-1"
            >
              <Show when={isSubmitting()} fallback={t('createGroup.createButton')}>
                <LoadingSpinner size="small" />
              </Show>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
