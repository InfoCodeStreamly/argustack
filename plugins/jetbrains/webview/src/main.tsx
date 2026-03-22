import { createRoot } from 'react-dom/client';
import { App } from './App.js';

console.log('[Argustack] Webview loading...');
console.log('[Argustack] sendToPlugin available at load:', typeof window.sendToPlugin);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
  console.log('[Argustack] React mounted');
}
