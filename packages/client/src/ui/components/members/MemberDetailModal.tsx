/**
 * MemberDetailModal - View and edit member details
 * Shows joined date (read-only), name, phone, payment info, and info text
 */

import { Component, createSignal, createEffect, Show, For } from 'solid-js';
import type { Member, MemberState, MemberPaymentInfo } from '@partage/shared';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { useI18n } from '../../../i18n';

export interface MemberDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  member: Member | null;
  memberState: MemberState | null;
  onSave: (updates: {
    name?: string;
    phone?: string;
    payment?: MemberPaymentInfo;
    info?: string;
  }) => Promise<void>;
  canEdit: boolean;
}

// Payment method labels and icons
const PAYMENT_METHODS = [
  { key: 'iban', label: 'IBAN', icon: '🏦' },
  { key: 'wero', label: 'Wero', icon: '💶' },
  { key: 'lydia', label: 'Lydia', icon: '📱' },
  { key: 'revolut', label: 'Revolut', icon: '💳' },
  { key: 'paypal', label: 'PayPal', icon: '🅿️' },
  { key: 'venmo', label: 'Venmo', icon: '💸' },
  { key: 'btc', label: 'Bitcoin', icon: '₿' },
  { key: 'cardano', label: 'Cardano', icon: '🪙' },
] as const;

/**
 * Normalize username by removing leading @ if present
 */
function normalizeUsername(username: string): string {
  return username.startsWith('@') ? username.slice(1) : username;
}

/**
 * Generate payment link for supported methods
 */
function getPaymentLink(method: string, value: string): string | null {
  const normalized = normalizeUsername(value);
  switch (method) {
    case 'lydia':
      return `https://pay.lydia.me/l?t=${encodeURIComponent(normalized)}`;
    case 'revolut':
      return `https://revolut.me/${encodeURIComponent(normalized)}`;
    case 'paypal':
      return `https://paypal.me/${encodeURIComponent(normalized)}`;
    case 'venmo':
      return `https://venmo.com/${encodeURIComponent(normalized)}`;
    case 'btc':
      return `bitcoin:${value}`;
    default:
      return null;
  }
}

export const MemberDetailModal: Component<MemberDetailModalProps> = (props) => {
  const { t, locale } = useI18n();
  const [name, setName] = createSignal('');
  const [phone, setPhone] = createSignal('');
  const [payment, setPayment] = createSignal<MemberPaymentInfo>({});
  const [info, setInfo] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [isEditing, setIsEditing] = createSignal(false);
  const [copiedField, setCopiedField] = createSignal<string | null>(null);

  // Reset form when modal opens or member changes
  createEffect(() => {
    if (props.isOpen && props.member && props.memberState) {
      setName(props.member.name);
      setPhone(props.memberState.phone || '');
      setPayment(props.memberState.payment || {});
      setInfo(props.memberState.info || '');
      setError(null);
      setIsEditing(false);
    }
  });

  const formatJoinedDate = (timestamp: number) => {
    const localeCode = locale() === 'fr' ? 'fr-FR' : 'en-US';
    const date = new Date(timestamp);
    return date.toLocaleDateString(localeCode, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const updatePaymentField = (key: keyof MemberPaymentInfo, value: string) => {
    setPayment({ ...payment(), [key]: value || undefined });
  };

  const handleSave = async () => {
    const trimmedName = name().trim();
    if (!trimmedName) {
      setError(t('memberDetail.nameRequired'));
      return;
    }

    try {
      setIsSaving(true);
      setError(null);

      await props.onSave({
        name: trimmedName !== props.member?.name ? trimmedName : undefined,
        phone: phone().trim() || undefined,
        payment: payment(),
        info: info().trim() || undefined,
      });

      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (props.member && props.memberState) {
      setName(props.member.name);
      setPhone(props.memberState.phone || '');
      setPayment(props.memberState.payment || {});
      setInfo(props.memberState.info || '');
    }
    setIsEditing(false);
    setError(null);
  };

  const hasPaymentInfo = () => {
    const p = props.memberState?.payment;
    return p && PAYMENT_METHODS.some((method) => p[method.key as keyof MemberPaymentInfo]);
  };

  const copyToClipboard = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={isEditing() ? t('memberDetail.editTitle') : t('memberDetail.title')}
    >
      <Show when={props.member && props.memberState}>
        <div class="member-detail-modal">
          {/* Joined date (always read-only) */}
          <div class="member-detail-row member-detail-row--readonly">
            <span class="member-detail-label">{t('memberDetail.joined')}</span>
            <span class="member-detail-value">{formatJoinedDate(props.member!.joinedAt)}</span>
          </div>

          <Show
            when={isEditing()}
            fallback={
              /* View mode */
              <>
                {/* Name */}
                <div class="member-detail-row member-detail-row--with-action">
                  <span class="member-detail-label">{t('memberDetail.name')}</span>
                  <div class="member-detail-value-wrapper">
                    <span class="member-detail-value">{props.member!.name}</span>
                    <button
                      class="copy-button"
                      onClick={() => copyToClipboard(props.member!.name, 'name')}
                      title={t('memberDetail.copy')}
                    >
                      {copiedField() === 'name' ? '✓' : '📋'}
                    </button>
                  </div>
                </div>

                {/* Phone */}
                <Show when={props.memberState!.phone}>
                  <div class="member-detail-row member-detail-row--with-action">
                    <span class="member-detail-label">{t('memberDetail.phone')}</span>
                    <div class="member-detail-value-wrapper">
                      <span class="member-detail-value">
                        <a href={`tel:${props.memberState!.phone}`}>{props.memberState!.phone}</a>
                      </span>
                      <button
                        class="copy-button"
                        onClick={() => copyToClipboard(props.memberState!.phone!, 'phone')}
                        title={t('memberDetail.copy')}
                      >
                        {copiedField() === 'phone' ? '✓' : '📋'}
                      </button>
                    </div>
                  </div>
                </Show>

                {/* Payment info */}
                <Show when={hasPaymentInfo()}>
                  <div class="member-detail-section">
                    <h3 class="member-detail-section-title">{t('memberDetail.paymentInfo')}</h3>
                    <For each={PAYMENT_METHODS}>
                      {(method) => {
                        const value =
                          props.memberState!.payment?.[method.key as keyof MemberPaymentInfo];
                        return (
                          <Show when={value}>
                            <div class="member-detail-row member-detail-row--payment member-detail-row--with-action">
                              <span class="member-detail-label">
                                {method.icon} {method.label}
                              </span>
                              <div class="member-detail-value-wrapper">
                                <span class="member-detail-value member-detail-value--mono">
                                  {(() => {
                                    const link = getPaymentLink(method.key, value!);
                                    return link ? (
                                      <a href={link} target="_blank" rel="noopener noreferrer">
                                        {value}
                                      </a>
                                    ) : (
                                      value
                                    );
                                  })()}
                                </span>
                                <button
                                  class="copy-button"
                                  onClick={() => copyToClipboard(value!, `payment-${method.key}`)}
                                  title={t('memberDetail.copy')}
                                >
                                  {copiedField() === `payment-${method.key}` ? '✓' : '📋'}
                                </button>
                              </div>
                            </div>
                          </Show>
                        );
                      }}
                    </For>
                  </div>
                </Show>

                {/* Info */}
                <Show when={props.memberState!.info}>
                  <div class="member-detail-row member-detail-row--info">
                    <span class="member-detail-label">{t('memberDetail.info')}</span>
                    <span class="member-detail-value">{props.memberState!.info}</span>
                  </div>
                </Show>

                {/* Edit button */}
                <Show when={props.canEdit}>
                  <div class="modal-actions">
                    <Button variant="secondary" onClick={props.onClose}>
                      {t('common.close')}
                    </Button>
                    <Button variant="primary" onClick={() => setIsEditing(true)}>
                      {t('common.edit')}
                    </Button>
                  </div>
                </Show>
              </>
            }
          >
            {/* Edit mode */}
            <div class="member-detail-form">
              {/* Name */}
              <div class="form-group">
                <label class="form-label" for="member-name">
                  {t('memberDetail.name')} *
                </label>
                <Input
                  id="member-name"
                  type="text"
                  value={name()}
                  onInput={(e) => setName(e.currentTarget.value)}
                  placeholder={t('memberDetail.namePlaceholder')}
                  required
                />
              </div>

              {/* Phone */}
              <div class="form-group">
                <label class="form-label" for="member-phone">
                  {t('memberDetail.phone')}
                </label>
                <Input
                  id="member-phone"
                  type="text"
                  value={phone()}
                  onInput={(e) => setPhone(e.currentTarget.value)}
                  placeholder={t('memberDetail.phonePlaceholder')}
                />
              </div>

              {/* Payment info */}
              <div class="form-group">
                <label class="form-label">{t('memberDetail.paymentInfo')}</label>
                <div class="member-detail-payment-fields">
                  <For each={PAYMENT_METHODS}>
                    {(method) => (
                      <div class="member-detail-payment-field">
                        <label class="member-detail-payment-label">
                          {method.icon} {method.label}
                        </label>
                        <Input
                          type="text"
                          value={payment()[method.key as keyof MemberPaymentInfo] || ''}
                          onInput={(e) =>
                            updatePaymentField(
                              method.key as keyof MemberPaymentInfo,
                              e.currentTarget.value
                            )
                          }
                          placeholder={t(`memberDetail.${method.key}Placeholder`)}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </div>

              {/* Info */}
              <div class="form-group">
                <label class="form-label" for="member-info">
                  {t('memberDetail.info')}
                </label>
                <textarea
                  id="member-info"
                  class="input textarea"
                  value={info()}
                  onInput={(e) => setInfo(e.currentTarget.value)}
                  placeholder={t('memberDetail.infoPlaceholder')}
                  rows={2}
                />
              </div>

              {/* Error message */}
              <Show when={error()}>
                <div class="error-message">{error()}</div>
              </Show>

              {/* Actions */}
              <div class="modal-actions">
                <Button variant="secondary" onClick={handleCancel} disabled={isSaving()}>
                  {t('common.cancel')}
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={isSaving()}>
                  {isSaving() ? t('common.loading') : t('common.save')}
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </Show>
    </Modal>
  );
};
