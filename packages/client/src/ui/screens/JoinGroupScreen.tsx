/**
 * Join Group Screen - Simplified trusted group join flow
 * Flow:
 * 1. Parse groupId and groupKey from URL params (hash-based routing)
 * 2. Import group key and fetch group data from server
 * 3. Display existing members and ask user to:
 *    - Enter new name as new member, OR
 *    - Claim existing virtual member identity
 * 4. Add member to Loro CRDT (with alias if claiming existing)
 * 5. Sync to server and navigate to group
 */

import { Component, createSignal, onMount, Show, For } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useAppContext } from '../context/AppContext';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Select } from '../components/common/Select';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
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
  const params = useParams<{ groupId: string; groupKey: string }>();
  const navigate = useNavigate();
  const { identity, initializeIdentity, groups, joinGroupWithKey } = useAppContext();

  const [groupName, setGroupName] = createSignal<string>('');
  const [groupKeyBase64, setGroupKeyBase64] = createSignal<string>('');
  const [existingMembers, setExistingMembers] = createSignal<Member[]>([]);
  const [userName, setUserName] = createSignal('');
  const [selectedExistingMember, setSelectedExistingMember] = createSignal<string | null>(null);
  const [joinAsNewMember, setJoinAsNewMember] = createSignal(true);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<
    'loading' | 'ready' | 'joining' | 'success' | 'error'
  >('loading');

  onMount(async () => {
    try {
      setStatus('loading');

      // Get groupId and groupKey from URL params
      const { groupId, groupKey: groupKeyBase64Url } = params;
      if (!groupId || !groupKeyBase64Url) {
        throw new Error('Invalid invite link: missing group ID or key');
      }

      // Convert Base64URL (from URL) back to standard Base64
      const groupKey = base64UrlToBase64(groupKeyBase64Url);
      setGroupKeyBase64(groupKey);
      console.log('[JoinGroupScreen] Converted Base64URL key to Base64');

      // Check if we already have this group
      const existingGroup = groups().find(g => g.id === groupId);
      if (existingGroup) {
        setError('You are already a member of this group');
        setStatus('error');
        return;
      }

      // Ensure user has identity
      let currentIdentity = identity();
      if (!currentIdentity) {
        console.log('[JoinGroupScreen] No identity found, initializing...');
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

        const members = tempStore.getMembers();
        setExistingMembers(members.filter(m => m.status === 'active'));
      }

      setStatus('ready');
    } catch (err) {
      console.error('[JoinGroupScreen] Failed to parse invite or fetch group data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load invite. Please try again.');
      setStatus('error');
    }
  });

  const handleJoinGroup = async (e: Event) => {
    e.preventDefault();

    if (joinAsNewMember() && !userName().trim()) {
      setError('Please enter your name');
      return;
    }

    if (!joinAsNewMember() && !selectedExistingMember()) {
      setError('Please select which member you are');
      return;
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

      // Join the group using the simplified method (with converted Base64 key)
      await joinGroupWithKey(
        groupId,
        groupKeyBase64(),
        joinAsNewMember() ? userName() : existingMembers().find(m => m.id === selectedExistingMember())?.name || userName(),
        joinAsNewMember() ? undefined : selectedExistingMember() || undefined
      );

      setStatus('success');

      // Navigate to group view (joinGroupWithKey auto-selects the group)
      setTimeout(() => navigate('/'), 500);
    } catch (err) {
      console.error('[JoinGroupScreen] Failed to join group:', err);
      setError(err instanceof Error ? err.message : 'Failed to join group. Please try again.');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="container" style="padding-top: var(--space-xl); max-width: 500px; margin: 0 auto;">
      <div style="margin-bottom: var(--space-xl);">
        <h1 style="font-size: var(--font-size-2xl); font-weight: var(--font-weight-bold); margin-bottom: var(--space-sm);">
          Join Group
        </h1>
      </div>

      <div>
        <Show
          when={status() !== 'loading'}
          fallback={
            <div class="loading-container">
              <LoadingSpinner />
              <p class="text-secondary">Loading group...</p>
            </div>
          }
        >
          <Show when={status() === 'error'}>
            <div class="error-container">
              <p class="error-message">{error()}</p>
              <Button variant="secondary" onClick={() => navigate('/')} class="btn-full-width">
                Go Home
              </Button>
            </div>
          </Show>

          <Show when={status() === 'ready'}>
            <div class="card" style="padding: var(--space-lg);">
              <div style="margin-bottom: var(--space-lg); text-align: center;">
                <h2 style="font-size: var(--font-size-xl); font-weight: var(--font-weight-bold); color: var(--color-text); margin-bottom: var(--space-sm);">
                  {groupName()}
                </h2>
                <p style="color: var(--color-text-light);">
                  You've been invited to join this trusted group!
                </p>
              </div>

              <form onSubmit={handleJoinGroup}>
                {/* Choice: New member or existing member */}
                <div class="form-group">
                  <label class="form-label">I am...</label>
                  <div style="display: flex; gap: var(--space-sm); margin-bottom: var(--space-md);">
                    <div style="flex: 1;">
                      <Button
                        type="button"
                        variant={joinAsNewMember() ? 'primary' : 'secondary'}
                        onClick={() => {
                          setJoinAsNewMember(true);
                          setSelectedExistingMember(null);
                        }}
                        class="btn-full-width"
                      >
                        A new member
                      </Button>
                    </div>
                    <div style="flex: 1;">
                      <Button
                        type="button"
                        variant={!joinAsNewMember() ? 'primary' : 'secondary'}
                        onClick={() => setJoinAsNewMember(false)}
                        disabled={existingMembers().length === 0}
                        class="btn-full-width"
                      >
                        An existing member
                      </Button>
                    </div>
                  </div>
                </div>

                {/* New member: enter name */}
                <Show when={joinAsNewMember()}>
                  <div class="form-group">
                    <label class="form-label">Your Name</label>
                    <Input
                      type="text"
                      value={userName()}
                      onInput={(e) => setUserName(e.currentTarget.value)}
                      placeholder="Enter your name"
                      required
                    />
                  </div>
                </Show>

                {/* Existing member: select from list */}
                <Show when={!joinAsNewMember()}>
                  <div class="form-group">
                    <label class="form-label">Select Your Name</label>
                    <Select
                      value={selectedExistingMember() || ''}
                      onChange={(e) => setSelectedExistingMember(e.currentTarget.value)}
                      required
                    >
                      <option value="" disabled>
                        Choose...
                      </option>
                      <For each={existingMembers()}>
                        {(member) => (
                          <option value={member.id}>{member.name}</option>
                        )}
                      </For>
                    </Select>
                    <p class="text-secondary text-small" style="margin-top: var(--space-xs);">
                      Claiming this identity will link your transactions under this name
                    </p>
                  </div>
                </Show>

                <Show when={error()}>
                  <p class="error-message">{error()}</p>
                </Show>

                <div style="display: flex; flex-direction: column; gap: var(--space-sm); margin-top: var(--space-lg);">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      loading() ||
                      (joinAsNewMember() && !userName().trim()) ||
                      (!joinAsNewMember() && !selectedExistingMember())
                    }
                    class="btn-full-width"
                  >
                    {loading() ? 'Joining...' : 'Join Group'}
                  </Button>
                  <Button variant="secondary" onClick={() => navigate('/')} class="btn-full-width">
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </Show>

          <Show when={status() === 'success'}>
            <div class="success-container">
              <div style="text-align: center;">
                <div style="font-size: 48px; margin-bottom: var(--space-md);">✓</div>
                <h2>Welcome to {groupName()}!</h2>
                <p class="text-secondary">You've successfully joined the group.</p>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};
