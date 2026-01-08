import { Component, createSignal, createEffect, Show } from 'solid-js'
import { Modal } from '../common/Modal'
import { ExpenseForm } from './ExpenseForm'
import { TransferForm } from './TransferForm'
import type { ExpenseFormData, TransferFormData } from './types'
import type { Entry, ExpenseEntry, TransferEntry } from '@partage/shared'

export interface AddEntryModalProps {
  isOpen: boolean
  onClose: () => void
  onAddExpense: (data: ExpenseFormData) => Promise<void>
  onAddTransfer: (data: TransferFormData) => Promise<void>
  // Edit mode props
  editEntry?: Entry | null
  onModifyExpense?: (originalId: string, data: ExpenseFormData) => Promise<void>
  onModifyTransfer?: (originalId: string, data: TransferFormData) => Promise<void>
}

type TabType = 'expense' | 'transfer'

export const AddEntryModal: Component<AddEntryModalProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<TabType>('expense')

  // Check if we're in edit mode
  const isEditMode = () => !!props.editEntry

  // Auto-select correct tab when editing
  createEffect(() => {
    if (props.editEntry) {
      setActiveTab(props.editEntry.type as TabType)
    }
  })

  const handleClose = () => {
    if (!isEditMode()) {
      setActiveTab('expense') // Reset to expense tab only when not editing
    }
    props.onClose()
  }

  // Handle expense submit - route to add or modify based on mode
  const handleExpenseSubmit = async (data: ExpenseFormData) => {
    if (isEditMode() && props.onModifyExpense && props.editEntry) {
      await props.onModifyExpense(props.editEntry.id, data)
    } else {
      await props.onAddExpense(data)
    }
  }

  // Handle transfer submit - route to add or modify based on mode
  const handleTransferSubmit = async (data: TransferFormData) => {
    if (isEditMode() && props.onModifyTransfer && props.editEntry) {
      await props.onModifyTransfer(props.editEntry.id, data)
    } else {
      await props.onAddTransfer(data)
    }
  }

  // Get expense data for edit mode
  const expenseInitialData = () => {
    if (props.editEntry?.type === 'expense') {
      return props.editEntry as ExpenseEntry
    }
    return undefined
  }

  // Get transfer data for edit mode
  const transferInitialData = () => {
    if (props.editEntry?.type === 'transfer') {
      return props.editEntry as TransferEntry
    }
    return undefined
  }

  return (
    <Modal isOpen={props.isOpen} onClose={handleClose}>
      <div class="add-entry-modal">
        <div class="modal-header">
          <h2 class="modal-title">{isEditMode() ? 'Edit Entry' : 'Add Entry'}</h2>
          <button class="modal-close-btn" onClick={handleClose}>
            ✕
          </button>
        </div>

        {/* Hide tabs in edit mode - can't change entry type */}
        <Show when={!isEditMode()}>
          <div class="modal-tabs">
            <button
              class={`modal-tab ${activeTab() === 'expense' ? 'active' : ''}`}
              onClick={() => setActiveTab('expense')}
            >
              Expense
            </button>
            <button
              class={`modal-tab ${activeTab() === 'transfer' ? 'active' : ''}`}
              onClick={() => setActiveTab('transfer')}
            >
              Transfer
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
              initialData={transferInitialData()}
            />
          </Show>
        </div>
      </div>
    </Modal>
  )
}
