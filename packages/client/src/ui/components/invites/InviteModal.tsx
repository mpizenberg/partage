/**
 * Invite Modal - Share invite links for a group
 * Allows group members to generate and share invite links
 */

import { Component, createSignal, Show, createEffect } from 'solid-js';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import QRCode from 'qrcode';

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
  let canvasRef: HTMLCanvasElement | undefined;

  // Generate QR code when invite link changes
  createEffect(() => {
    const link = props.inviteLink;
    if (link && canvasRef) {
      QRCode.toCanvas(canvasRef, link, {
        width: 256,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      }, (error) => {
        if (error) {
          console.error('QR Code generation failed:', error);
        }
      });
    }
  });

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
        <Show
          when={props.inviteLink}
          fallback={
            <div class="invite-generate">
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
            <div class="invite-qr-code">
              <canvas
                ref={canvasRef}
                style="display: block; margin: 0 auto; max-width: 100%;"
              />
            </div>

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
      </div>
    </Modal>
  );
};
