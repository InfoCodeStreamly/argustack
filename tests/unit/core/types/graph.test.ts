import { describe, it, expect } from 'vitest';
import type { GraphEntity, GraphRelationship, GraphObservation, GraphStats } from '../../../../src/core/types/graph.js';

describe('Graph types', () => {
  it('GraphEntity has required fields', () => {
    const entity: GraphEntity = { name: 'test', type: 'issue', properties: {} };
    expect(entity.name).toBe('test');
    expect(entity.type).toBe('issue');
  });

  it('GraphRelationship has required fields', () => {
    const rel: GraphRelationship = { sourceId: 1, targetId: 2, type: 'assigned_to', weight: 1, source: 'structural', properties: {} };
    expect(rel.type).toBe('assigned_to');
  });

  it('GraphObservation has required fields', () => {
    const obs: GraphObservation = { entityId: 1, content: 'test note', author: 'claude' };
    expect(obs.content).toBe('test note');
  });

  it('GraphStats has counts', () => {
    const stats: GraphStats = { entityCount: 10, relationshipCount: 20, observationCount: 5, byEntityType: {}, byRelationshipType: {} };
    expect(stats.entityCount).toBe(10);
  });
});
