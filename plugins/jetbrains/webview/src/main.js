import { jsx as _jsx } from "react/jsx-runtime";
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
console.log('[Argustack] Webview loading...');
console.log('[Argustack] sendToPlugin available at load:', typeof window.sendToPlugin);
const root = document.getElementById('root');
if (root) {
    createRoot(root).render(_jsx(App, {}));
    console.log('[Argustack] React mounted');
}
