import { Component, JSX, Show, createEffect, onCleanup } from 'solid-js';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
}

// Track if we're currently closing a modal to prevent double-back
let isClosingFromBackButton = false;

export const Modal: Component<ModalProps> = (props) => {
  let pushedState = false;

  // Handle mobile back button navigation
  createEffect(() => {
    if (props.isOpen) {
      // Push a state to history when modal opens
      const modalId = `modal-${Date.now()}`;
      window.history.pushState({ modalId }, '');
      pushedState = true;

      // Handle popstate (back button)
      const handlePopState = () => {
        if (pushedState) {
          pushedState = false;
          isClosingFromBackButton = true;
          props.onClose();
          // Reset flag after a short delay
          setTimeout(() => {
            isClosingFromBackButton = false;
          }, 50);
        }
      };

      window.addEventListener('popstate', handlePopState);

      onCleanup(() => {
        window.removeEventListener('popstate', handlePopState);
        // Clean up history state when modal closes normally (not via back button)
        if (pushedState && !isClosingFromBackButton) {
          pushedState = false;
          window.history.back();
        }
      });
    }
  });

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  return (
    <Show when={props.isOpen}>
      <div class="modal-overlay" onClick={handleOverlayClick}>
        <div class="modal-content">
          <Show when={props.title}>
            <div class="modal-header">
              <h2 class="modal-title">{props.title}</h2>
              <button class="modal-close" onClick={props.onClose} aria-label="Close modal">
                ×
              </button>
            </div>
          </Show>
          <div class="modal-body">{props.children}</div>
        </div>
      </div>
    </Show>
  );
};
