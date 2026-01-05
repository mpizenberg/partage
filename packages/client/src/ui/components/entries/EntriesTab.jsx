import { Show } from 'solid-js';
import { useAppContext } from '../../context/AppContext';
import { EntryList } from './EntryList';
export const EntriesTab = () => {
    const { entries } = useAppContext();
    return (<div class="entries-tab">
      <Show when={entries().length > 0} fallback={<div class="empty-state">
            <div class="empty-state-icon">📝</div>
            <h2 class="empty-state-title">No entries yet</h2>
            <p class="empty-state-message">
              Tap the + button below to add your first expense or transfer
            </p>
          </div>}>
        <EntryList entries={entries()}/>
      </Show>
    </div>);
};
