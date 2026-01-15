/**
 * Join Group Screen - Simplified trusted group join flow
 * Flow:
 * 1. Parse groupId from URL path and groupKey from URL fragment (#)
 * 2. Import group key and fetch group data from server
 * 3. Display existing members and ask user to:
 *    - Enter new name as new member, OR
 *    - Claim existing virtual member identity
 * 4. Add member to Loro CRDT (with alias if claiming existing)
 * 5. Sync to server and navigate to group
 *
 * URL format: /join/:groupId#<base64url-key>
 * The key is in the fragment so it's never sent to the server
 */

import { Component, createSignal, onMount, Show, For, createEffect } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useI18n } from '../../i18n';
import { useAppContext, checkCanJoinGroup } from '../context/AppContext';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { LanguageSwitcher } from '../components/common/LanguageSwitcher';
import { pbClient, PocketBaseClient } from '../../api';
import type { Member } from '@partage/shared';

/**
 * Convert Base64URL back to standard Base64
 */
function base64UrlToBase64(base64Url: string): string {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return base64;
}

export const JoinGroupScreen: Component = () => {
  const { t } = useI18n();
  const params = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const { identity, initializeIdentity, groups, joinGroupWithKey } = useAppContext();

  const [groupName, setGroupName] = createSignal<string>('');
  const [groupKeyBase64, setGroupKeyBase64] = createSignal<string>('');
  const [existingMembers, setExistingMembers] = createSignal<Member[]>([]);
  const [claimedVirtualMemberIds, setClaimedVirtualMemberIds] = createSignal<Set<string>>(new Set());
  const [userName, setUserName] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<
    'loading' | 'ready' | 'joining' | 'success' | 'error'
  >('loading');
  const [showRealMembers, setShowRealMembers] = createSignal(false);
  const [nameError, setNameError] = createSignal<string>('');

  // Separate members into virtual (unclaimed) and real, sorted alphabetically by name
  const virtualMembers = () =>
    existingMembers()
      .filter(m => m.isVirtual === true)
      .filter(m => !claimedVirtualMemberIds().has(m.id))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  const realMembers = () =>
    existingMembers()
      .filter(m => m.isVirtual !== true)
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

  // Validate that name is not already taken
  const validateName = (name: string): boolean => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError(t('joinGroup.nameRequired'));
      return false;
    }
    if (existingMembers().some(m => m.name === trimmedName)) {
      setNameError(t('joinGroup.duplicateName'));
      return false;
    }
    setNameError('');
    return true;
  };

  createEffect(() => {
    if (userName()) {
      validateName(userName());
    }
  });

  onMount(async () => {
    try {
      setStatus('loading');

      // Get groupId from URL path params
      const { groupId } = params;
      if (!groupId) {
        throw new Error(t('joinGroup.invalidLink'));
      }

      // Get groupKey from URL fragment (after #)
      // Fragment is never sent to the server, keeping the key secure
      const hash = window.location.hash;
      const groupKeyBase64Url = hash.startsWith('#') ? hash.substring(1) : hash;
      if (!groupKeyBase64Url) {
        throw new Error(t('joinGroup.invalidLink'));
      }

      // Convert Base64URL (from URL) back to standard Base64
      const groupKey = base64UrlToBase64(groupKeyBase64Url);
      setGroupKeyBase64(groupKey);
      console.log('[JoinGroupScreen] Extracted key from URL fragment');

      // Ensure user has identity (AppContext has already initialized at this point)
      let currentIdentity = identity();
      if (!currentIdentity) {
        await initializeIdentity();
        currentIdentity = identity();

        if (!currentIdentity) {
          throw new Error('Failed to initialize identity');
        }
      }

      // Try to fetch group metadata from server
      try {
        const groupRecord = await pbClient.getGroup(groupId);
        setGroupName(groupRecord.name);
      } catch (err) {
        console.warn('[JoinGroupScreen] Could not fetch group metadata from server:', err);
        setGroupName('Group'); // Fallback name
      }

      // Fetch all updates from server to get member list
      const updates = await pbClient.fetchAllUpdates(groupId);

      // Apply updates to a temporary Loro store to get members
      if (updates.length > 0) {
        const { LoroEntryStore } = await import('../../core/crdt/loro-wrapper');
        const tempStore = new LoroEntryStore(currentIdentity.publicKeyHash);

        for (const update of updates) {
          const updateBytes = PocketBaseClient.decodeUpdateData(update.updateData);
          tempStore.applyUpdate(updateBytes);
        }

        // Check if we already have this group AND current identity is a member
        const canJoin = checkCanJoinGroup(
          groupId,
          groups(),
          tempStore,
          currentIdentity.publicKeyHash
        );

        if (!canJoin) {
          setError(t('joinGroup.alreadyMember'));
          setStatus('error');
          return;
        }

        // Get all member states using the event-based system
        const allStates = tempStore.getAllMemberStates();
        const members: Member[] = [];
        const claimed = new Set<string>();

        for (const [memberId, state] of allStates) {
          // Track replaced members
          if (state.isReplaced) {
            claimed.add(memberId);
          }
          // Only include active members (not retired, not replaced)
          if (state.isActive) {
            members.push({
              id: memberId,
              name: state.name,
              publicKey: state.publicKey,
              joinedAt: state.createdAt,
              status: 'active',
              isVirtual: state.isVirtual,
              addedBy: state.createdBy,
            });
          }
        }

        setExistingMembers(members);
        setClaimedVirtualMemberIds(claimed);
      }

      // Auto-expand real members list if no unclaimed virtual members
      if (virtualMembers().length === 0 && realMembers().length > 0) {
        setShowRealMembers(true);
      }

      setStatus('ready');
    } catch (err) {
      console.error('[JoinGroupScreen] Failed to parse invite or fetch group data:', err);
      setError(err instanceof Error ? err.message : t('joinGroup.invalidLinkMessage'));
      setStatus('error');
    }
  });

  const handleJoinGroup = async (memberId?: string) => {
    // Validate if joining as new member
    if (!memberId) {
      if (!validateName(userName())) {
        return;
      }
    }

    setLoading(true);
    setStatus('joining');
    setError(null);

    try {
      const { groupId } = params;
      const currentIdentity = identity();

      if (!currentIdentity) {
        throw new Error('Identity not found');
      }

      const memberName = memberId
        ? existingMembers().find(m => m.id === memberId)?.name || ''
        : userName();

      // Join the group using the simplified method (with converted Base64 key)
      await joinGroupWithKey(
        groupId,
        groupKeyBase64(),
        memberName,
        memberId // Pass memberId if claiming existing member
      );

      setStatus('success');

      // Navigate to the group view
      setTimeout(() => navigate(`/groups/${groupId}`), 500);
    } catch (err) {
      console.error('[JoinGroupScreen] Failed to join group:', err);
      setError(err instanceof Error ? err.message : 'Failed to join group. Please try again.');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="container" style="padding-top: var(--space-xl); max-width: 500px; margin: 0 auto; padding-bottom: 60px;">
      {/* Language switcher in top-right corner */}
      <div style="position: absolute; top: 1rem; right: 1rem;">
        <LanguageSwitcher />
      </div>

      {/* Header */}
      <div style="margin-bottom: var(--space-lg);">
        <h1 style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin-bottom: var(--space-md);">
          {t('joinGroup.title')}
        </h1>
        <p style="color: var(--color-text); margin-bottom: var(--space-sm);">
          {t('setup.subtitle')}
        </p>
        <p style="color: var(--color-text-light); font-size: var(--font-size-sm);">
          {t('setup.privacy')}
        </p>
      </div>

      <div>
        <Show
          when={status() !== 'loading'}
          fallback={
            <div class="loading-container">
              <LoadingSpinner />
              <p class="text-secondary">{t('joinGroup.loading')}</p>
            </div>
          }
        >
          <Show when={status() === 'error'}>
            <div class="error-container">
              <p class="error-message">{error()}</p>
              <Button variant="secondary" onClick={() => navigate('/')} class="btn-full-width">
                {t('common.back')}
              </Button>
            </div>
          </Show>

          <Show when={status() === 'ready'}>
            <div class="card" style="padding: var(--space-lg);">
              {/* Group name header */}
              <div style="margin-bottom: var(--space-lg); text-align: center;">
                <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text);">
                  {groupName()}
                </h2>
              </div>

              {/* Virtual members: Join as existing virtual member */}
              <Show when={virtualMembers().length > 0}>
                <div style="margin-bottom: var(--space-lg);">
                  <p style="font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-md); color: var(--color-text);">
                    {t('joinGroup.areYouOneOfThese')}
                  </p>
                  <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
                    <For each={virtualMembers()}>
                      {(member) => (
                        <Button
                          variant="primary"
                          onClick={() => handleJoinGroup(member.id)}
                          disabled={loading()}
                          class="btn-full-width"
                        >
                          {member.name}
                        </Button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* Real members: Re-join as existing real member (collapsed/expanded based on context) */}
              <Show when={realMembers().length > 0}>
                <div style="margin-bottom: var(--space-lg); border-top: 1px solid var(--color-border); padding-top: var(--space-md);">
                  <button
                    type="button"
                    onClick={() => setShowRealMembers(!showRealMembers())}
                    style="
                      background: none;
                      border: none;
                      padding: 0;
                      cursor: pointer;
                      font-size: var(--font-size-sm);
                      font-weight: var(--font-weight-semibold);
                      color: var(--color-text);
                      display: flex;
                      align-items: center;
                      gap: var(--space-xs);
                      margin-bottom: var(--space-md);
                      width: 100%;
                    "
                  >
                    <span>
                      {t('joinGroup.rejoinAs')}
                      <Show when={virtualMembers().length > 0}>
                        <span style="font-size: var(--font-size-xs); color: var(--color-text-light); margin-left: var(--space-xs);">
                          {t('joinGroup.clickToExpand')}
                        </span>
                      </Show>
                    </span>
                    <span style="margin-left: auto;">
                      {showRealMembers() ? '▼' : '▶'}
                    </span>
                  </button>

                  <Show when={showRealMembers()}>
                    <div style="display: flex; flex-direction: column; gap: var(--space-sm);">
                      <For each={realMembers()}>
                        {(member) => (
                          <Button
                            variant="secondary"
                            onClick={() => handleJoinGroup(member.id)}
                            disabled={loading()}
                            class="btn-full-width"
                          >
                            {member.name}
                          </Button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </Show>

              {/* New member form */}
              <div style="border-top: 1px solid var(--color-border); padding-top: var(--space-md);">
                <p style="font-size: var(--font-size-sm); font-weight: var(--font-weight-semibold); margin-bottom: var(--space-md); color: var(--color-text);">
                  {t('joinGroup.joinAsNewMember')}
                </p>

                <div style="display: flex; gap: var(--space-sm);">
                  <div style="flex: 1;">
                    <Input
                      type="text"
                      value={userName()}
                      onInput={(e) => setUserName(e.currentTarget.value)}
                      placeholder={t('joinGroup.namePlaceholder')}
                      error={!!nameError()}
                      disabled={loading()}
                    />
                    <Show when={nameError()}>
                      <p class="error-message" style="margin-top: var(--space-xs); font-size: var(--font-size-sm);">
                        {nameError()}
                      </p>
                    </Show>
                  </div>
                  <Button
                    variant="primary"
                    onClick={() => handleJoinGroup()}
                    disabled={loading() || !userName().trim() || !!nameError()}
                  >
                    {loading() ? t('joinGroup.joining') : t('common.ok')}
                  </Button>
                </div>
              </div>

              {/* Global error message */}
              <Show when={error()}>
                <p class="error-message" style="margin-top: var(--space-md);">
                  {error()}
                </p>
              </Show>
            </div>
          </Show>

          <Show when={status() === 'success'}>
            <div class="success-container">
              <div style="text-align: center;">
                <div style="font-size: 48px; margin-bottom: var(--space-md);">✓</div>
                <h2>{groupName()}</h2>
                <p class="text-secondary">{t('common.done')}</p>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};
