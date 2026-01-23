/**
 * GroupInfoSection - Display group description and links
 * Clickable section that opens edit modal
 */

import { Component, For, Show } from 'solid-js';
import type { GroupLink } from '@partage/shared';
import { useI18n } from '../../../i18n';

export interface GroupInfoSectionProps {
  description?: string;
  links: GroupLink[];
  onEdit: () => void;
  disabled?: boolean;
}

export const GroupInfoSection: Component<GroupInfoSectionProps> = (props) => {
  const { t } = useI18n();

  const hasContent = () => !!props.description || props.links.length > 0;

  const handleLinkClick = (e: MouseEvent, url: string) => {
    e.stopPropagation(); // Prevent triggering the edit modal
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div
      class="group-info-section"
      classList={{
        'group-info-section--clickable': !props.disabled,
        'group-info-section--empty': !hasContent(),
      }}
      onClick={() => !props.disabled && props.onEdit()}
      role={props.disabled ? undefined : 'button'}
      tabIndex={props.disabled ? undefined : 0}
      onKeyPress={(e) => e.key === 'Enter' && !props.disabled && props.onEdit()}
    >
      <Show
        when={hasContent()}
        fallback={
          <div class="group-info-placeholder">
            <span class="group-info-placeholder-icon">+</span>
            <span class="group-info-placeholder-text">{t('groupInfo.addInfo')}</span>
          </div>
        }
      >
        <Show when={props.description}>
          <p class="group-info-description">{props.description}</p>
        </Show>

        <Show when={props.links.length > 0}>
          <div class="group-info-links">
            <For each={props.links}>
              {(link) => (
                <button
                  class="group-info-link-chip"
                  onClick={(e) => handleLinkClick(e, link.url)}
                  title={link.url}
                >
                  <span class="group-info-link-icon">🔗</span>
                  <span class="group-info-link-label">{link.label}</span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>

      <Show when={!props.disabled && hasContent()}>
        <span class="group-info-edit-hint">{t('groupInfo.clickToEdit')}</span>
      </Show>
    </div>
  );
};
