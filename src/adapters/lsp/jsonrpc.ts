/**
 * LSP framing helpers (Content-Length + body).
 * `vscode-jsonrpc` does the heavy lifting at runtime; this module is here
 * for a low-level fallback / future migration off the dependency.
 */

export function encodeMessage(payload: unknown): Buffer {
  const json = JSON.stringify(payload);
  const body = Buffer.from(json, 'utf8');
  const header = `Content-Length: ${String(body.byteLength)}\r\n\r\n`;
  return Buffer.concat([Buffer.from(header, 'utf8'), body]);
}

export interface DecodedMessage {
  payload: unknown;
  consumed: number;
}

export function tryDecodeMessage(buffer: Buffer): DecodedMessage | null {
  const headerEnd = buffer.indexOf('\r\n\r\n');
  if (headerEnd === -1) {
    return null;
  }
  const header = buffer.subarray(0, headerEnd).toString('utf8');
  const match = /Content-Length: (\d+)/i.exec(header);
  if (match?.[1] === undefined || match[1] === '') {
    return null;
  }
  const length = Number(match[1]);
  const bodyStart = headerEnd + 4;
  if (buffer.length < bodyStart + length) {
    return null;
  }
  const body = buffer.subarray(bodyStart, bodyStart + length).toString('utf8');
  return { payload: JSON.parse(body), consumed: bodyStart + length };
}
