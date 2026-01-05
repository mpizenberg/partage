/* @refresh reload */
import { render } from 'solid-js/web';
import App from './App';
// Import global styles
import './ui/styles/reset.css';
import './ui/styles/variables.css';
import './ui/styles/layout.css';
import './ui/styles/components.css';
const root = document.getElementById('root');
if (!root) {
    throw new Error('Root element not found');
}
render(() => <App />, root);
