/* @refresh reload */
import { render } from 'solid-js/web'
import App from './App'

// Import global styles
import './ui/styles/reset.css'
import './ui/styles/variables.css'
import './ui/styles/layout.css'
import './ui/styles/components.css'

console.log('[main.tsx] Starting Partage app...')

const root = document.getElementById('root')

if (!root) {
  throw new Error('Root element not found')
}

console.log('[main.tsx] Rendering App...')
render(() => <App />, root)
console.log('[main.tsx] App rendered')
