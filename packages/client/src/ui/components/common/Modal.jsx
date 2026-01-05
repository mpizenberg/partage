import { Show } from 'solid-js';
export const Modal = (props) => {
    const handleOverlayClick = (e) => {
        if (e.target === e.currentTarget) {
            props.onClose();
        }
    };
    return (<Show when={props.isOpen}>
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
    </Show>);
};
