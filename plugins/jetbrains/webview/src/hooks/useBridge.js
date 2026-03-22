import { useCallback, useEffect, useRef } from 'react';
export function useBridge(onResponse) {
    const handlerRef = useRef(onResponse);
    handlerRef.current = onResponse;
    useEffect(() => {
        console.log('[Argustack] useBridge mounted, sendToPlugin available:', typeof window.sendToPlugin);
        window.receiveFromPlugin = (payload) => {
            console.log('[Argustack] received from plugin:', payload.substring(0, 100));
            const response = JSON.parse(payload);
            handlerRef.current(response);
        };
        return () => {
            window.receiveFromPlugin = undefined;
        };
    }, []);
    const send = useCallback((message) => {
        const serialized = JSON.stringify(message);
        console.log('[Argustack] sending to plugin:', serialized);
        if (window.sendToPlugin) {
            window.sendToPlugin(serialized);
        }
        else {
            console.warn('[Argustack] sendToPlugin not available!');
        }
    }, []);
    return { send };
}
