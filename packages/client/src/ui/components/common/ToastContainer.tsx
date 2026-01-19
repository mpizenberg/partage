import { Component, For } from 'solid-js';
import { Toast } from './Toast';
import type { ToastData } from '../../context/ToastContext';

export interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: Component<ToastContainerProps> = (props) => {
  return (
    <div class="toast-container" aria-live="polite" aria-atomic="false">
      <For each={props.toasts}>
        {(toast) => (
          <Toast
            id={toast.id}
            type={toast.type}
            message={toast.message}
            onDismiss={props.onDismiss}
            autoDismissMs={5000}
          />
        )}
      </For>
    </div>
  );
};
