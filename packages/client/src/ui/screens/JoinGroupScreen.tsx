/**
 * Join Group Screen - Handles joining a group via invite link
 * Flow:
 * 1. Parse invite link from URL
 * 2. Display group name and ask for user's name
 * 3. Submit join request
 * 4. Wait for key package from existing member
 * 5. Import keys and join group
 */

import { Component, createSignal, onMount, Show } from 'solid-js';
import { useNavigate, useParams } from '@solidjs/router';
import { useAppContext } from '../context/AppContext';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { parseInviteLink } from '../../domain/invitations/invite-manager';
import type { InviteLinkData } from '@partage/shared';

export const JoinGroupScreen: Component = () => {
  const params = useParams();
  const navigate = useNavigate();
  const { submitJoinRequest, identity, initializeIdentity } = useAppContext();

  const [linkData, setLinkData] = createSignal<InviteLinkData | null>(null);
  const [userName, setUserName] = createSignal('');
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<
    'loading' | 'ready' | 'submitting' | 'waiting' | 'success' | 'error'
  >('loading');

  onMount(() => {
    try {
      // Parse invite link from URL parameter
      const encodedData = params.inviteData;
      if (!encodedData) {
        setError('Invalid invite link');
        setStatus('error');
        return;
      }

      // Reconstruct full invite link
      const inviteLink = `${window.location.origin}/join/${encodedData}`;
      const data = parseInviteLink(inviteLink);
      setLinkData(data);
      setStatus('ready');
    } catch (err) {
      console.error('Failed to parse invite link:', err);
      setError('Invalid or expired invite link');
      setStatus('error');
    }
  });

  const handleJoinGroup = async (e: Event) => {
    e.preventDefault();

    if (!userName().trim()) {
      setError('Please enter your name');
      return;
    }

    if (!linkData()) {
      setError('Invite link data not found');
      return;
    }

    setLoading(true);
    setStatus('submitting');
    setError(null);

    try {
      // Check if user has identity, if not create one automatically
      let currentIdentity = identity();
      if (!currentIdentity) {
        console.log('[JoinGroupScreen] No identity found, initializing...');
        await initializeIdentity();
        currentIdentity = identity();

        if (!currentIdentity) {
          throw new Error('Failed to initialize identity');
        }
      }

      // Submit join request via AppContext
      await submitJoinRequest(
        linkData()!.invitationId,
        linkData()!.groupId,
        userName()
      );

      // Show waiting status
      // The AppContext will automatically:
      // 1. Subscribe to key packages
      // 2. Import keys when received
      // 3. Add group to groups list
      setStatus('waiting');

      // Poll for group to appear (keys received and imported)
      // Once keys are imported, the group will be in the groups list
      // For now, just show the waiting message
      // The user will need to navigate back and select the group manually
      // or we could add auto-navigation when the group appears

      console.log('Join request submitted successfully for:', {
        groupName: linkData()!.groupName,
        userName: userName(),
      });
    } catch (err) {
      console.error('Failed to join group:', err);
      setError(err instanceof Error ? err.message : 'Failed to join group. Please try again.');
      setStatus('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div class="screen">
      <div class="screen-header">
        <h1 class="screen-title">Join Group</h1>
      </div>

      <div class="screen-content">
        <Show
          when={status() !== 'loading'}
          fallback={
            <div class="loading-container">
              <LoadingSpinner />
              <p class="text-secondary">Loading invite...</p>
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
            <div class="join-group-form">
              <div class="group-info">
                <h2 class="group-name">{linkData()?.groupName}</h2>
                <p class="text-secondary">You've been invited to join this group!</p>
              </div>

              <form onSubmit={handleJoinGroup}>
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

                <Show when={error()}>
                  <p class="error-message">{error()}</p>
                </Show>

                <div class="form-actions">
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={loading() || !userName().trim()}
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

          <Show when={status() === 'waiting'}>
            <div class="waiting-container">
              <LoadingSpinner />
              <h2>Waiting for Approval</h2>
              <p class="text-secondary">
                Your join request has been sent. You'll be added to the group once an existing
                member approves your request.
              </p>
              <p class="text-secondary text-small">This usually takes just a few moments...</p>
              <div class="form-actions">
                <Button variant="primary" onClick={() => navigate('/')} class="btn-full-width">
                  Go to Groups
                </Button>
              </div>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};
