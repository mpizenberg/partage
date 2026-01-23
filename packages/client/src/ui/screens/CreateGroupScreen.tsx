import { Component, createSignal, Show, For, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { useI18n } from '../../i18n';
import { useAppContext } from '../context/AppContext';
import { Input } from '../components/common/Input';
import { Select, SelectOption } from '../components/common/Select';
import { Button } from '../components/common/Button';
import { MemberManager } from '../components/forms/MemberManager';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { pbClient } from '../../api';
import { BackgroundPoWSolver, type PoWState } from '../../core/pow/proof-of-work';
import type { Member, GroupLink } from '@partage/shared';

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

  // Optional metadata state
  const [subtitle, setSubtitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [links, setLinks] = createSignal<GroupLink[]>([]);
  const [newLinkLabel, setNewLinkLabel] = createSignal('');
  const [newLinkUrl, setNewLinkUrl] = createSignal('');
  const [showOptionalFields, setShowOptionalFields] = createSignal(false);

  // PoW state - using background solver
  const [powState, setPowState] = createSignal<PoWState>({ status: 'idle' });
  const [isWaitingForPoW, setIsWaitingForPoW] = createSignal(false);

  // Create background PoW solver
  const powSolver = new BackgroundPoWSolver(() => pbClient.getPoWChallenge());

  // Start background PoW computation on mount
  onMount(() => {
    powSolver.onStateChange((state) => {
      setPowState(state);
    });
    powSolver.start();
  });

  // Cleanup on unmount
  onCleanup(() => {
    powSolver.abort();
  });

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

  const handleAddLink = () => {
    const label = newLinkLabel().trim();
    const url = newLinkUrl().trim();

    if (!label || !url) return;

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      setValidationError(t('groupInfo.invalidUrl'));
      return;
    }

    setLinks([...links(), { label, url }]);
    setNewLinkLabel('');
    setNewLinkUrl('');
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links().filter((_, i) => i !== index));
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
      // Wait for PoW solution (returns immediately if already solved)
      setIsWaitingForPoW(true);
      const powSolution = await powSolver.waitForSolution();
      setIsWaitingForPoW(false);

      // Create the group with PoW solution
      // Pass only virtual members - AppContext will add current user
      const metadata = {
        subtitle: subtitle().trim() || undefined,
        description: description().trim() || undefined,
        links: links().length > 0 ? links() : undefined,
      };
      await createGroup(
        groupName().trim(),
        currency(),
        members(),
        powSolution,
        myName().trim(),
        metadata
      );

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
      setIsWaitingForPoW(false);
      // Error is already set in context
    }
  };

  // Check if form is currently submitting (waiting for PoW or creating group)
  const isSubmitting = () => isWaitingForPoW() || isLoading();

  // Check if PoW is still computing in background
  const isPowComputing = () => {
    const state = powState();
    return state.status === 'fetching' || state.status === 'solving';
  };

  // Get PoW progress info
  const getPowProgress = () => {
    const state = powState();
    if (state.status === 'solving') {
      return { hashes: state.hashesComputed, rate: state.hashRate };
    }
    return null;
  };

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

            {/* Optional fields toggle */}
            <div class="form-group">
              <button
                type="button"
                class="btn btn-link"
                onClick={() => setShowOptionalFields(!showOptionalFields())}
                style="padding: 0; text-align: left;"
              >
                {showOptionalFields() ? '▼' : '▶'} {t('createGroup.optionalFields')}
              </button>
            </div>

            {/* Optional metadata fields */}
            <Show when={showOptionalFields()}>
              {/* Subtitle */}
              <div class="form-group">
                <label class="form-label" for="subtitle">
                  {t('groupInfo.subtitle')}
                </label>
                <Input
                  id="subtitle"
                  type="text"
                  value={subtitle()}
                  placeholder={t('groupInfo.subtitlePlaceholder')}
                  onInput={(e) => setSubtitle(e.currentTarget.value)}
                />
              </div>

              {/* Description */}
              <div class="form-group">
                <label class="form-label" for="description">
                  {t('groupInfo.description')}
                </label>
                <textarea
                  id="description"
                  class="input textarea"
                  value={description()}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                  placeholder={t('groupInfo.descriptionPlaceholder')}
                  rows={3}
                />
              </div>

              {/* Links */}
              <div class="form-group">
                <label class="form-label">{t('groupInfo.links')}</label>

                {/* Existing links */}
                <Show when={links().length > 0}>
                  <div class="group-metadata-links-list" style="margin-bottom: var(--space-sm);">
                    <For each={links()}>
                      {(link, index) => (
                        <div class="group-metadata-link-item">
                          <span class="group-metadata-link-label">{link.label}</span>
                          <span class="group-metadata-link-url">{link.url}</span>
                          <button
                            type="button"
                            class="group-metadata-link-remove"
                            onClick={() => handleRemoveLink(index())}
                            aria-label={t('groupInfo.removeLink')}
                          >
                            ×
                          </button>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>

                {/* Add new link */}
                <div
                  class="group-metadata-add-link"
                  style="display: flex; gap: var(--space-xs); flex-wrap: wrap;"
                >
                  <div style="flex: 1; min-width: 120px;">
                    <Input
                      type="text"
                      value={newLinkLabel()}
                      onInput={(e) => setNewLinkLabel(e.currentTarget.value)}
                      placeholder={t('groupInfo.linkLabelPlaceholder')}
                    />
                  </div>
                  <div style="flex: 2; min-width: 200px;">
                    <Input
                      type="text"
                      value={newLinkUrl()}
                      onInput={(e) => setNewLinkUrl(e.currentTarget.value)}
                      placeholder={t('groupInfo.linkUrlPlaceholder')}
                    />
                  </div>
                  <Button type="button" variant="secondary" onClick={handleAddLink}>
                    +
                  </Button>
                </div>
              </div>
            </Show>
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

          {/* PoW Progress - shown when waiting after submit and PoW not ready */}
          <Show when={isWaitingForPoW() && isPowComputing()}>
            <div class="info-message mb-md">
              <div class="flex items-center gap-sm">
                <LoadingSpinner size="small" />
                <span>{t('createGroup.solvingPoW')}</span>
              </div>
              <Show when={getPowProgress()}>
                <p class="text-sm text-muted mt-xs">
                  {t('createGroup.powProgress', {
                    hashes: (getPowProgress()?.hashes || 0).toLocaleString(),
                    rate: (getPowProgress()?.rate || 0).toLocaleString(),
                  })}
                </p>
              </Show>
            </div>
          </Show>

          {/* Subtle background PoW indicator - shown while filling form */}
          <Show when={!isWaitingForPoW() && isPowComputing()}>
            <div
              class="text-sm text-muted mb-md"
              style="display: flex; align-items: center; gap: var(--space-xs);"
            >
              <LoadingSpinner size="small" />
              <span>{t('createGroup.preparingInBackground')}</span>
            </div>
          </Show>

          {/* PoW Error */}
          <Show when={powState().status === 'error'}>
            <div class="error-message mb-md">
              {(powState() as { status: 'error'; error: string }).error}
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
