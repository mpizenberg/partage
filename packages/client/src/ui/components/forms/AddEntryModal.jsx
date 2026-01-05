import { createSignal, Show } from 'solid-js';
import { Modal } from '../common/Modal';
import { ExpenseForm } from './ExpenseForm';
import { TransferForm } from './TransferForm';
export const AddEntryModal = (props) => {
    const [activeTab, setActiveTab] = createSignal('expense');
    const handleClose = () => {
        setActiveTab('expense'); // Reset to expense tab
        props.onClose();
    };
    return (<Modal isOpen={props.isOpen} onClose={handleClose}>
      <div class="add-entry-modal">
        <div class="modal-header">
          <h2 class="modal-title">Add Entry</h2>
          <button class="modal-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>

        <div class="modal-tabs">
          <button class={`modal-tab ${activeTab() === 'expense' ? 'active' : ''}`} onClick={() => setActiveTab('expense')}>
            Expense
          </button>
          <button class={`modal-tab ${activeTab() === 'transfer' ? 'active' : ''}`} onClick={() => setActiveTab('transfer')}>
            Transfer
          </button>
        </div>

        <div class="modal-body">
          <Show when={activeTab() === 'expense'}>
            <ExpenseForm onSubmit={props.onAddExpense} onCancel={handleClose}/>
          </Show>
          <Show when={activeTab() === 'transfer'}>
            <TransferForm onSubmit={props.onAddTransfer} onCancel={handleClose}/>
          </Show>
        </div>
      </div>
    </Modal>);
};
