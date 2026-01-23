/**
 * GroupMetadataModal - Edit group metadata (subtitle, description, links)
 */

import { Component, createSignal, For, Show, createEffect } from 'solid-js';
import type { GroupMetadataState, GroupLink } from '@partage/shared';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { Input } from '../common/Input';
import { useI18n } from '../../../i18n';

export interface GroupMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMetadata: GroupMetadataState;
  onSave: (metadata: {
    subtitle?: string;
    description?: string;
    links?: GroupLink[];
  }) => Promise<void>;
}

export const GroupMetadataModal: Component<GroupMetadataModalProps> = (props) => {
  const { t } = useI18n();
  const [subtitle, setSubtitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [links, setLinks] = createSignal<GroupLink[]>([]);
  const [newLinkLabel, setNewLinkLabel] = createSignal('');
  const [newLinkUrl, setNewLinkUrl] = createSignal('');
  const [isSaving, setIsSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Reset form when modal opens
  createEffect(() => {
    if (props.isOpen) {
      setSubtitle(props.currentMetadata.subtitle || '');
      setDescription(props.currentMetadata.description || '');
      setLinks([...props.currentMetadata.links]);
      setNewLinkLabel('');
      setNewLinkUrl('');
      setError(null);
    }
  });

  const handleAddLink = () => {
    const label = newLinkLabel().trim();
    const url = newLinkUrl().trim();

    if (!label || !url) {
      setError(t('groupInfo.linkRequiredFields'));
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      setError(t('groupInfo.invalidUrl'));
      return;
    }

    setLinks([...links(), { label, url }]);
    setNewLinkLabel('');
    setNewLinkUrl('');
    setError(null);
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links().filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      setError(null);

      await props.onSave({
        subtitle: subtitle().trim() || undefined,
        description: description().trim() || undefined,
        links: links(),
      });

      props.onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen={props.isOpen} onClose={props.onClose} title={t('groupInfo.editTitle')}>
      <div class="group-metadata-form">
        {/* Subtitle */}
        <div class="form-group">
          <label class="form-label" for="group-subtitle">
            {t('groupInfo.subtitle')}
          </label>
          <Input
            id="group-subtitle"
            type="text"
            value={subtitle()}
            onInput={(e) => setSubtitle(e.currentTarget.value)}
            placeholder={t('groupInfo.subtitlePlaceholder')}
          />
        </div>

        {/* Description */}
        <div class="form-group">
          <label class="form-label" for="group-description">
            {t('groupInfo.description')}
          </label>
          <textarea
            id="group-description"
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
            <div class="group-metadata-links-list">
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
          <div class="group-metadata-add-link">
            <Input
              type="text"
              value={newLinkLabel()}
              onInput={(e) => setNewLinkLabel(e.currentTarget.value)}
              placeholder={t('groupInfo.linkLabelPlaceholder')}
            />
            <Input
              type="text"
              value={newLinkUrl()}
              onInput={(e) => setNewLinkUrl(e.currentTarget.value)}
              placeholder={t('groupInfo.linkUrlPlaceholder')}
            />
            <Button type="button" variant="secondary" onClick={handleAddLink}>
              {t('groupInfo.addLink')}
            </Button>
          </div>
        </div>

        {/* Error message */}
        <Show when={error()}>
          <div class="error-message">{error()}</div>
        </Show>

        {/* Actions */}
        <div class="modal-actions">
          <Button variant="secondary" onClick={props.onClose} disabled={isSaving()}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving()}>
            {isSaving() ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
