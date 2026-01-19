/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';

// Import global styles
import './ui/styles/reset.css';
import './ui/styles/variables.css';
import './ui/styles/layout.css';
import './ui/styles/components.css';

// Import component-specific styles
import './ui/styles/components/screens.css';
import './ui/styles/components/members.css';
import './ui/styles/components/balance.css';
import './ui/styles/components/entries.css';
import './ui/styles/components/forms.css';
import './ui/styles/components/activities.css';
import './ui/styles/components/settle.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <App />, root);
