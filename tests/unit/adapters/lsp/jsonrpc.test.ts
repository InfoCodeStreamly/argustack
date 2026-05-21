import { describe, it, expect } from 'vitest';
import { encodeMessage, tryDecodeMessage } from '../../../../src/adapters/lsp/jsonrpc.js';

describe('lsp/jsonrpc framing', () => {
  it('encode then decode roundtrips a payload', () => {
    const payload = { jsonrpc: '2.0', method: 'initialize', id: 1 };
    const buf = encodeMessage(payload);
    const decoded = tryDecodeMessage(buf);
    expect(decoded).not.toBeNull();
    expect(decoded?.payload).toEqual(payload);
  });

  it('tryDecodeMessage returns null for incomplete buffer', () => {
    expect(tryDecodeMessage(Buffer.from('Content-Length: 100\r\n\r\n{}'))).toBeNull();
  });

  it('tryDecodeMessage returns null without header', () => {
    expect(tryDecodeMessage(Buffer.from('not a header'))).toBeNull();
  });
});
