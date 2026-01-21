/**
 * Invite Modal - Share invite links for a group
 * Allows group members to generate and share invite links
 */

import { Component, createSignal, Show } from 'solid-js';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { useI18n } from '../../../i18n';
import QRCode from 'qrcode';

export interface InviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  groupName: string;
  inviteLink: string | null;
}

export const InviteModal: Component<InviteModalProps> = (props) => {
  const { t } = useI18n();
  const [copied, setCopied] = createSignal(false);

  // Generate QR code when canvas is mounted and link is available
  const generateQRCode = (canvas: HTMLCanvasElement) => {
    const link = props.inviteLink;
    if (link && canvas) {
      QRCode.toCanvas(
        canvas,
        link,
        {
          width: 256,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#FFFFFF',
          },
        },
        (error) => {
          if (error) {
            console.error('QR Code generation failed:', error);
          }
        }
      );
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
          title: t('invite.shareTitle', { groupName: props.groupName }),
          text: t('invite.shareText', { groupName: props.groupName }),
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
    <Modal isOpen={props.isOpen} onClose={props.onClose} title={t('invite.title')}>
      <div class="invite-modal">
        <Show
          when={props.inviteLink}
          fallback={
            <div class="invite-generate" style="text-align: center; padding: var(--space-lg);">
              <div class="loading-spinner" style="margin: 0 auto;" />
              <p style="margin-top: var(--space-md); color: var(--color-text-light);">
                {t('invite.generating')}
              </p>
            </div>
          }
        >
          <div class="invite-link-container">
            <div class="invite-qr-code">
              <canvas
                ref={generateQRCode}
                style="display: block; margin: 0 auto; max-width: 100%;"
              />
            </div>

            <div class="invite-link-box">
              <code class="invite-link">{props.inviteLink}</code>
            </div>

            <div class="invite-actions">
              <Button variant="primary" onClick={handleCopyLink} class="btn-full-width">
                {copied() ? `✓ ${t('invite.copied')}` : t('invite.copyLink')}
              </Button>

              <Show when={navigator.share}>
                <Button variant="secondary" onClick={handleShareLink} class="btn-full-width">
                  {t('invite.share')}
                </Button>
              </Show>
            </div>

            <div
              class="invite-security-warning"
              style={{
                'margin-top': 'var(--space-md)',
                padding: 'var(--space-sm)',
                background: 'var(--color-warning-light, #fff3cd)',
                border: '1px solid var(--color-warning, #ffc107)',
                'border-radius': 'var(--border-radius)',
                'font-size': 'var(--font-size-sm)',
                color: 'var(--color-text)',
              }}
            >
              <strong>⚠️ {t('invite.securityWarningTitle')}</strong>
              <p style="margin: 'var(--space-xs) 0 0 0'">
                {t('invite.securityWarningMessage')}
              </p>
            </div>
          </div>
        </Show>
      </div>
    </Modal>
  );
};
