import { useCallback, useEffect, useRef } from 'react';
import type { BridgeMessage, BridgeResponse } from '../types.js';

type ResponseHandler = (response: BridgeResponse) => void;

export function useBridge(onResponse: ResponseHandler) {
  const handlerRef = useRef(onResponse);
  handlerRef.current = onResponse;

  useEffect(() => {
    console.log('[Argustack] useBridge mounted, sendToPlugin available:', typeof window.sendToPlugin);

    window.receiveFromPlugin = (payload: string) => {
      console.log('[Argustack] received from plugin:', payload.substring(0, 100));
      const response = JSON.parse(payload) as BridgeResponse;
      handlerRef.current(response);
    };

    return () => {
      window.receiveFromPlugin = undefined;
    };
  }, []);

  const send = useCallback((message: BridgeMessage) => {
    const serialized = JSON.stringify(message);
    console.log('[Argustack] sending to plugin:', serialized);
    if (window.sendToPlugin) {
      window.sendToPlugin(serialized);
    } else {
      console.warn('[Argustack] sendToPlugin not available!');
    }
  }, []);

  return { send };
}
