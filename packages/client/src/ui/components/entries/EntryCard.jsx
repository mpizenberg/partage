import { Show } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
// Category emoji mapping
const CATEGORY_EMOJI = {
    food: '🍔',
    transport: '🚗',
    accommodation: '🏨',
    entertainment: '🎬',
    shopping: '🛍️',
    groceries: '🛒',
    utilities: '💡',
    healthcare: '⚕️',
    other: '📝',
};
export const EntryCard = (props) => {
    const { members, identity } = useAppContext();
    const formatCurrency = (amount, currency) => {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: currency,
        }).format(amount);
    };
    const formatRelativeTime = (timestamp) => {
        const now = Date.now();
        const diff = now - timestamp;
        const seconds = Math.floor(diff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        if (days > 7) {
            return new Date(timestamp).toLocaleDateString(undefined, {
                month: 'short',
                day: 'numeric',
            });
        }
        else if (days > 0) {
            return `${days} day${days > 1 ? 's' : ''} ago`;
        }
        else if (hours > 0) {
            return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        }
        else if (minutes > 0) {
            return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
        }
        else {
            return 'Just now';
        }
    };
    const getMemberName = (memberId) => {
        if (memberId === identity()?.publicKeyHash)
            return 'You';
        const member = members().find(m => m.id === memberId);
        return member?.name || 'Unknown';
    };
    const isExpense = () => props.entry.type === 'expense';
    const isTransfer = () => props.entry.type === 'transfer';
    const expenseEntry = () => (isExpense() ? props.entry : null);
    const transferEntry = () => (isTransfer() ? props.entry : null);
    const getCategoryEmoji = () => {
        const expense = expenseEntry();
        if (!expense || !expense.category)
            return '📝';
        return CATEGORY_EMOJI[expense.category] || '📝';
    };
    const getPayersText = () => {
        const expense = expenseEntry();
        if (!expense)
            return '';
        const payerNames = expense.payers.map(p => getMemberName(p.memberId));
        if (payerNames.length === 1)
            return payerNames[0];
        if (payerNames.length === 2)
            return payerNames.join(' and ');
        return `${payerNames[0]} and ${payerNames.length - 1} other${payerNames.length > 2 ? 's' : ''}`;
    };
    const getBeneficiariesText = () => {
        const expense = expenseEntry();
        if (!expense)
            return '';
        const beneficiaryNames = expense.beneficiaries.map(b => getMemberName(b.memberId));
        if (beneficiaryNames.length === 1)
            return beneficiaryNames[0];
        if (beneficiaryNames.length === 2)
            return beneficiaryNames.join(' and ');
        if (beneficiaryNames.length === 3)
            return beneficiaryNames.join(', ');
        return `${beneficiaryNames.slice(0, 2).join(', ')} and ${beneficiaryNames.length - 2} more`;
    };
    const getUserShare = () => {
        const expense = expenseEntry();
        if (!expense)
            return null;
        const userId = identity()?.publicKeyHash;
        if (!userId)
            return null;
        const beneficiary = expense.beneficiaries.find(b => b.memberId === userId);
        if (!beneficiary)
            return null;
        if (beneficiary.splitType === 'exact' && beneficiary.amount !== undefined) {
            return beneficiary.amount;
        }
        if (beneficiary.splitType === 'shares' && beneficiary.shares !== undefined) {
            const totalShares = expense.beneficiaries.reduce((sum, b) => sum + (b.shares || 0), 0);
            return (expense.amount * beneficiary.shares) / totalShares;
        }
        return null;
    };
    const isUserInvolved = () => {
        const userId = identity()?.publicKeyHash;
        if (!userId)
            return false;
        if (isExpense()) {
            const expense = expenseEntry();
            return (expense.payers.some(p => p.memberId === userId) ||
                expense.beneficiaries.some(b => b.memberId === userId));
        }
        if (isTransfer()) {
            const transfer = transferEntry();
            return transfer.from === userId || transfer.to === userId;
        }
        return false;
    };
    return (<div class={`entry-card card ${isUserInvolved() ? 'entry-card-involved' : ''}`}>
      {/* Expense Entry */}
      <Show when={isExpense()}>
        <div class="entry-header">
          <div class="entry-icon">{getCategoryEmoji()}</div>
          <div class="entry-main">
            <h3 class="entry-description">{expenseEntry().description}</h3>
            <div class="entry-amount">
              {formatCurrency(props.entry.amount, props.entry.currency)}
              <Show when={expenseEntry()?.category}>
                <span class="entry-category"> • {expenseEntry()?.category}</span>
              </Show>
            </div>
          </div>
        </div>

        <div class="entry-details">
          <div class="entry-detail-row">
            <span class="entry-detail-label">Paid by:</span>
            <span class="entry-detail-value">{getPayersText()}</span>
          </div>
          <div class="entry-detail-row">
            <span class="entry-detail-label">Split:</span>
            <span class="entry-detail-value">{getBeneficiariesText()}</span>
          </div>
          <Show when={getUserShare() !== null}>
            <div class="entry-detail-row entry-user-share">
              <span class="entry-detail-label">Your share:</span>
              <span class="entry-detail-value">
                {formatCurrency(getUserShare(), props.entry.currency)}
              </span>
            </div>
          </Show>
        </div>

        <div class="entry-footer">
          <span class="entry-time">{formatRelativeTime(props.entry.createdAt)}</span>
        </div>
      </Show>

      {/* Transfer Entry */}
      <Show when={isTransfer()}>
        <div class="entry-header">
          <div class="entry-icon">💸</div>
          <div class="entry-main">
            <h3 class="entry-description">Transfer</h3>
            <div class="entry-amount">
              {formatCurrency(props.entry.amount, props.entry.currency)}
            </div>
          </div>
        </div>

        <div class="entry-details">
          <div class="entry-detail-row">
            <span class="entry-detail-label">From:</span>
            <span class="entry-detail-value">{getMemberName(transferEntry().from)}</span>
          </div>
          <div class="entry-detail-row">
            <span class="entry-detail-label">To:</span>
            <span class="entry-detail-value">{getMemberName(transferEntry().to)}</span>
          </div>
          <Show when={transferEntry()?.notes}>
            <div class="entry-detail-row">
              <span class="entry-detail-label">Note:</span>
              <span class="entry-detail-value">{transferEntry()?.notes}</span>
            </div>
          </Show>
        </div>

        <div class="entry-footer">
          <span class="entry-time">{formatRelativeTime(props.entry.createdAt)}</span>
        </div>
      </Show>
    </div>);
};
