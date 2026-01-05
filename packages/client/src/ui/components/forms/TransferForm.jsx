import { createSignal, For } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { Input } from '../common/Input';
import { Select } from '../common/Select';
import { Button } from '../common/Button';
export const TransferForm = (props) => {
    const { members, activeGroup, identity } = useAppContext();
    const [amount, setAmount] = createSignal('');
    const [currency, setCurrency] = createSignal(activeGroup()?.defaultCurrency || 'USD');
    const [from, setFrom] = createSignal('');
    const [to, setTo] = createSignal('');
    const [date, setDate] = createSignal(new Date().toISOString().split('T')[0]);
    const [notes, setNotes] = createSignal('');
    const [errors, setErrors] = createSignal({});
    const [isSubmitting, setIsSubmitting] = createSignal(false);
    const validateForm = () => {
        const newErrors = {};
        const amountNum = parseFloat(amount());
        if (!amount() || isNaN(amountNum) || amountNum <= 0) {
            newErrors.amount = 'Amount must be greater than 0';
        }
        if (!from()) {
            newErrors.from = 'Please select who is sending the transfer';
        }
        if (!to()) {
            newErrors.to = 'Please select who is receiving the transfer';
        }
        if (from() && to() && from() === to()) {
            newErrors.to = 'Sender and receiver must be different';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validateForm())
            return;
        setIsSubmitting(true);
        try {
            const formData = {
                amount: parseFloat(amount()),
                currency: currency(),
                from: from(),
                to: to(),
                date: new Date(date() || Date.now()).getTime(),
                notes: notes() || undefined,
            };
            await props.onSubmit(formData);
            props.onCancel(); // Close modal on success
        }
        catch (error) {
            console.error('Failed to create transfer:', error);
            setErrors({ submit: 'Failed to create transfer. Please try again.' });
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (<form class="transfer-form" onSubmit={handleSubmit}>
      <div class="form-section">
        <div class="form-row">
          <div class="form-field">
            <label class="form-label">Amount</label>
            <Input type="number" value={amount()} placeholder="0.00" step={0.01} min={0} disabled={isSubmitting()} error={!!errors().amount} onInput={(e) => setAmount(e.currentTarget.value)}/>
          </div>

          <div class="form-field">
            <label class="form-label">Currency</label>
            <Select value={currency()} disabled={isSubmitting()} onChange={(e) => setCurrency(e.currentTarget.value)}>
              <For each={['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'NZD', 'MXN', 'SGD', 'HKD', 'NOK', 'KRW', 'TRY', 'INR', 'RUB', 'BRL', 'ZAR']}>
                {(curr) => <option value={curr}>{curr}</option>}
              </For>
            </Select>
          </div>
        </div>

        <div class="form-row">
          <div class="form-field">
            <label class="form-label">From</label>
            <Select value={from()} disabled={isSubmitting()} error={errors().from} onChange={(e) => setFrom(e.currentTarget.value)}>
              <option value="">Select member</option>
              <For each={members()}>
                {(member) => (<option value={member.id}>
                    {member.id === identity()?.publicKeyHash ? 'You' : member.name}
                  </option>)}
              </For>
            </Select>
          </div>

          <div class="form-field">
            <label class="form-label">To</label>
            <Select value={to()} disabled={isSubmitting()} error={errors().to} onChange={(e) => setTo(e.currentTarget.value)}>
              <option value="">Select member</option>
              <For each={members()}>
                {(member) => (<option value={member.id}>
                    {member.id === identity()?.publicKeyHash ? 'You' : member.name}
                  </option>)}
              </For>
            </Select>
          </div>
        </div>

        <div class="form-field">
          <label class="form-label">Date</label>
          <Input type="date" value={date()} disabled={isSubmitting()} onChange={(e) => setDate(e.currentTarget.value)}/>
        </div>

        <div class="form-field">
          <label class="form-label">Notes (optional)</label>
          <textarea class="form-textarea" value={notes()} placeholder="Add a note..." rows={3} disabled={isSubmitting()} onInput={(e) => setNotes(e.currentTarget.value)}/>
        </div>
      </div>

      {errors().submit && (<div class="form-error">{errors().submit}</div>)}

      <div class="form-actions">
        <Button type="button" variant="secondary" onClick={props.onCancel} disabled={isSubmitting()}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={isSubmitting()}>
          {isSubmitting() ? 'Creating...' : 'Create Transfer'}
        </Button>
      </div>
    </form>);
};
