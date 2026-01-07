/**
 * Invite Modal - Share invite links for a group
 * Allows group members to generate and share invite links
 */

import { Component, createSignal, Show } from 'solid-js';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

export interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  inviteLink: string | null;
  onGenerateLink: () => Promise<void>;
}

export const InviteModal: Component<InviteModalProps> = (props) => {
  const [copied, setCopied] = createSignal(false);
  const [generating, setGenerating] = createSignal(false);

  const handleGenerateLink = async () => {
    setGenerating(true);
    try {
      await props.onGenerateLink();
    } finally {
      setGenerating(false);
    }
  };

  const handleCopyLink = async () => {
    if (!props.inviteLink) return;

    try {
      await navigator.clipboard.writeText(props.inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy link:', error);
    }
  };

  const handleShareLink = async () => {
    if (!props.inviteLink) return;

    // Use Web Share API if available
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Join ${props.groupName} on Partage`,
          text: `You've been invited to join ${props.groupName}!`,
          url: props.inviteLink,
        });
      } catch (error) {
        // User cancelled or share failed
        console.log('Share cancelled:', error);
      }
    } else {
      // Fallback to copy
      handleCopyLink();
    }
  };

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title="Invite Members">
      <div class="invite-modal">
        <p class="invite-description">
          Share this link with people you want to add to <strong>{props.groupName}</strong>.
        </p>

        <Show
          when={props.inviteLink}
          fallback={
            <div class="invite-generate">
              <p class="text-secondary">Generate an invite link to share with others.</p>
              <Button
                variant="primary"
                onClick={handleGenerateLink}
                disabled={generating()}
                class="btn-full-width"
              >
                {generating() ? 'Generating...' : 'Generate Invite Link'}
              </Button>
            </div>
          }
        >
          <div class="invite-link-container">
            <div class="invite-link-box">
              <code class="invite-link">{props.inviteLink}</code>
            </div>

            <div class="invite-actions">
              <Button variant="primary" onClick={handleCopyLink} class="btn-full-width">
                {copied() ? '✓ Copied!' : 'Copy Link'}
              </Button>

              <Show when={navigator.share}>
                <Button variant="secondary" onClick={handleShareLink} class="btn-full-width">
                  Share Link
                </Button>
              </Show>
            </div>
          </div>
        </Show>

        <div class="invite-info">
          <p class="text-secondary text-small">
            Anyone with this link can request to join your group. The link doesn't expire, but you
            can revoke it at any time.
          </p>
        </div>
      </div>
    </Modal>
  );
};
