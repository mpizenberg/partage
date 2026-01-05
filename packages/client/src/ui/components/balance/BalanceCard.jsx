import { Show } from 'solid-js';
export const BalanceCard = (props) => {
    const formatCurrency = (amount) => {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency: props.currency,
        }).format(amount);
    };
    const isSettled = () => {
        return Math.abs(props.balance.netBalance) < 0.01;
    };
    const getBalanceClass = () => {
        if (isSettled())
            return 'balance-neutral';
        return props.balance.netBalance > 0 ? 'balance-positive' : 'balance-negative';
    };
    const getBalanceText = () => {
        if (isSettled())
            return 'Settled up';
        const amount = Math.abs(props.balance.netBalance);
        if (props.balance.netBalance > 0) {
            return `is owed ${formatCurrency(amount)}`;
        }
        else {
            return `owes ${formatCurrency(amount)}`;
        }
    };
    return (<div class={`balance-card card ${props.isCurrentUser ? 'balance-card-current' : ''}`}>
      <div class="balance-card-header">
        <div class="balance-card-member">
          <span class="balance-card-name">{props.memberName}</span>
          <Show when={props.isCurrentUser}>
            <span class="member-badge">You</span>
          </Show>
        </div>
      </div>

      <div class="balance-card-amount">
        <div class={`balance-net ${getBalanceClass()}`}>
          {formatCurrency(Math.abs(props.balance.netBalance))}
        </div>
        <div class="balance-status text-muted">
          {getBalanceText()}
        </div>
      </div>

      <div class="balance-card-details">
        <div class="balance-detail">
          <span class="balance-detail-label">Paid:</span>
          <span class="balance-detail-value">{formatCurrency(props.balance.totalPaid)}</span>
        </div>
        <div class="balance-detail">
          <span class="balance-detail-label">Owed:</span>
          <span class="balance-detail-value">{formatCurrency(props.balance.totalOwed)}</span>
        </div>
      </div>
    </div>);
};
