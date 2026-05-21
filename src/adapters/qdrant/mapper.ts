import { createHash } from 'node:crypto';
import type { CodeChunk, SemanticHit, SemanticHitPayload } from '../../core/types/code.js';

export interface QdrantPoint {
  id: string;
  vector: number[];
  payload: Record<string, unknown>;
}

export function chunkToPoint(chunk: CodeChunk, vector: number[]): QdrantPoint {
  return {
    id: hashId(`${chunk.projectId}:${chunk.symbolId}`),
    vector,
    payload: {
      symbolId: chunk.symbolId,
      projectId: chunk.projectId,
      filePath: chunk.filePath,
      layer: chunk.layer,
      kind: chunk.kind,
      name: chunk.name,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      content: chunk.content,
    },
  };
}

interface QdrantSearchPoint {
  id: string | number;
  score: number;
  payload?: Record<string, unknown> | null;
}

function readString(payload: Record<string, unknown>, key: string, fallback = ''): string {
  const value = payload[key];
  return typeof value === 'string' ? value : fallback;
}

export function pointToHit(point: QdrantSearchPoint): SemanticHit {
  const payload = point.payload ?? {};
  const symbolIdValue = payload['symbolId'];
  const symbolId = typeof symbolIdValue === 'string'
    ? symbolIdValue
    : typeof point.id === 'string' ? point.id : String(point.id);
  const hitPayload: SemanticHitPayload = {
    projectId: readString(payload, 'projectId'),
    filePath: readString(payload, 'filePath'),
    layer: (payload['layer'] as SemanticHitPayload['layer']) ?? null,
    kind: readString(payload, 'kind', 'function') as SemanticHitPayload['kind'],
    name: readString(payload, 'name'),
    startLine: Number(payload['startLine'] ?? 0),
    endLine: Number(payload['endLine'] ?? 0),
  };
  const content = readString(payload, 'content');
  if (content) {
    hitPayload.content = content;
  }
  return {
    symbolId,
    score: point.score,
    payload: hitPayload,
  };
}

function hashId(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 32);
}

export { hashId };
