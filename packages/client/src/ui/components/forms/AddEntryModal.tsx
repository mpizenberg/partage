import { Component, createSignal, createEffect, Show } from 'solid-js';
import { useI18n } from '../../../i18n';
import { Modal } from '../common/Modal';
import { ExpenseForm } from './ExpenseForm';
import { TransferForm } from './TransferForm';
import type { ExpenseFormData, TransferFormData } from './types';
import type { Entry, ExpenseEntry, TransferEntry } from '@partage/shared';

export interface TransferInitialData {
  from?: string;
  to?: string;
  amount?: number;
  currency?: string;
}

export interface AddEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddExpense: (data: ExpenseFormData) => Promise<void>;
  onAddTransfer: (data: TransferFormData) => Promise<void>;
  // Edit mode props
  editEntry?: Entry | null;
  onModifyExpense?: (originalId: string, data: ExpenseFormData) => Promise<void>;
  onModifyTransfer?: (originalId: string, data: TransferFormData) => Promise<void>;
  // Pre-fill transfer data (for quick settlement)
  transferInitialData?: TransferInitialData | null;
}

type TabType = 'expense' | 'transfer';

export const AddEntryModal: Component<AddEntryModalProps> = (props) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = createSignal<TabType>('expense');

  // Check if we're in edit mode
  const isEditMode = () => !!props.editEntry;

  // Auto-select correct tab when editing or when transfer initial data is provided
  createEffect(() => {
    if (props.editEntry) {
      setActiveTab(props.editEntry.type as TabType);
    } else if (props.transferInitialData) {
      setActiveTab('transfer');
    }
  });

  const handleClose = () => {
    if (!isEditMode()) {
      setActiveTab('expense'); // Reset to expense tab only when not editing
    }
    props.onClose();
  };

  // Handle expense submit - route to add or modify based on mode
  const handleExpenseSubmit = async (data: ExpenseFormData) => {
    if (isEditMode() && props.onModifyExpense && props.editEntry) {
      await props.onModifyExpense(props.editEntry.id, data);
    } else {
      await props.onAddExpense(data);
    }
  };

  // Handle transfer submit - route to add or modify based on mode
  const handleTransferSubmit = async (data: TransferFormData) => {
    if (isEditMode() && props.onModifyTransfer && props.editEntry) {
      await props.onModifyTransfer(props.editEntry.id, data);
    } else {
      await props.onAddTransfer(data);
    }
  };

  // Get expense data for edit mode
  const expenseInitialData = () => {
    if (props.editEntry?.type === 'expense') {
      return props.editEntry as ExpenseEntry;
    }
    return undefined;
  };

  // Get transfer data for edit mode
  const transferEditData = () => {
    if (props.editEntry?.type === 'transfer') {
      return props.editEntry as TransferEntry;
    }
    return undefined;
  };

  // Combine edit data with pre-fill data for transfer form
  const getTransferInitialData = () => {
    // Edit mode takes priority
    if (transferEditData()) {
      return transferEditData();
    }

    // Otherwise use pre-fill data if available
    if (props.transferInitialData) {
      return props.transferInitialData;
    }

    return undefined;
  };

  return (
    <Modal isOpen={props.isOpen} onClose={handleClose}>
      <div class="add-entry-modal">
        <div class="modal-header">
          <h2 class="modal-title">
            {isEditMode() ? t('entries.editEntry') : t('entries.addEntry')}
          </h2>
          <button class="modal-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>

        {/* Hide tabs in edit mode or when pre-filling transfer data - can't change entry type */}
        <Show when={!isEditMode() && !props.transferInitialData}>
          <div class="modal-tabs">
            <button
              class={`modal-tab ${activeTab() === 'expense' ? 'active' : ''}`}
              onClick={() => setActiveTab('expense')}
            >
              {t('entries.expense')}
            </button>
            <button
              class={`modal-tab ${activeTab() === 'transfer' ? 'active' : ''}`}
              onClick={() => setActiveTab('transfer')}
            >
              {t('entries.transfer')}
            </button>
          </div>
        </Show>

        <div class="modal-body">
          <Show when={activeTab() === 'expense'}>
            <ExpenseForm
              onSubmit={handleExpenseSubmit}
              onCancel={handleClose}
              initialData={expenseInitialData()}
            />
          </Show>
          <Show when={activeTab() === 'transfer'}>
            <TransferForm
              onSubmit={handleTransferSubmit}
              onCancel={handleClose}
              initialData={getTransferInitialData()}
            />
          </Show>
        </div>
      </div>
    </Modal>
  );
};
