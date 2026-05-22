import type pg from 'pg';
import type {
  GraphEntity,
  GraphRelationship,
  GraphObservation,
  GraphQueryResult,
  GraphStats,
} from '../../core/types/index.js';

/**
 * Per-aggregate storage module: knowledge graph (entities,
 * relationships, observations). Orchestrated by `PostgresStorage`.
 */
export class PostgresGraphStorage {
  constructor(private readonly pool: pg.Pool) {}

  async saveGraphEntities(workspaceId: string, entities: GraphEntity[]): Promise<void> {
    for (const entity of entities) {
      await this.pool.query(
        `INSERT INTO graph_entities (workspace_id, name, type, properties)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, name, type) DO UPDATE SET properties = EXCLUDED.properties`,
        [workspaceId, entity.name, entity.type, JSON.stringify(entity.properties)],
      );
    }
  }

  async saveGraphRelationships(workspaceId: string, rels: GraphRelationship[]): Promise<void> {
    for (const rel of rels) {
      await this.pool.query(
        `INSERT INTO graph_relationships (workspace_id, source_id, target_id, type, weight, source, properties)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (workspace_id, source_id, target_id, type) DO UPDATE SET
           weight = EXCLUDED.weight,
           properties = EXCLUDED.properties`,
        [workspaceId, rel.sourceId, rel.targetId, rel.type, rel.weight, rel.source, JSON.stringify(rel.properties)],
      );
    }
  }

  async saveGraphObservation(
    workspaceId: string,
    entityId: number,
    content: string,
    author: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO graph_observations (workspace_id, entity_id, content, author) VALUES ($1, $2, $3, $4)`,
      [workspaceId, entityId, content, author],
    );
  }

  async getObservations(workspaceId: string, entityId: number): Promise<GraphObservation[]> {
    const result = await this.pool.query(
      `SELECT id, entity_id, content, author, created_at FROM graph_observations
       WHERE workspace_id = $1 AND entity_id = $2 ORDER BY created_at`,
      [workspaceId, entityId],
    );
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r['id'] as number,
      entityId: r['entity_id'] as number,
      content: r['content'] as string,
      author: r['author'] as string,
      createdAt: r['created_at'] as string,
    }));
  }

  async queryGraph(workspaceId: string, entityName: string, depth: number): Promise<GraphQueryResult> {
    const result = await this.pool.query(
      `WITH RECURSIVE graph_walk AS (
        SELECT id, name, type, properties, 0 as depth
        FROM graph_entities WHERE workspace_id = $1 AND name ILIKE $2
        UNION
        SELECT e.id, e.name, e.type, e.properties, gw.depth + 1
        FROM graph_walk gw
        JOIN graph_relationships r
          ON r.workspace_id = $1
         AND (r.source_id = gw.id OR r.target_id = gw.id)
        JOIN graph_entities e
          ON e.workspace_id = $1
         AND e.id = CASE WHEN r.source_id = gw.id THEN r.target_id ELSE r.source_id END
        WHERE gw.depth < $3
      )
      SELECT DISTINCT id, name, type, properties FROM graph_walk LIMIT 200`,
      [workspaceId, `%${entityName}%`, depth],
    );

    const entityIds = result.rows.map((r: Record<string, unknown>) => r['id'] as number);
    const entities: GraphEntity[] = result.rows.map((r: Record<string, unknown>) => ({
      id: r['id'] as number,
      name: r['name'] as string,
      type: r['type'] as string,
      properties: r['properties'] as Record<string, unknown>,
    }));

    let relationships: GraphRelationship[] = [];
    let observations: GraphObservation[] = [];

    if (entityIds.length > 0) {
      const idList = entityIds.map((_, i) => `$${String(i + 2)}`).join(',');

      const relResult = await this.pool.query(
        `SELECT id, source_id, target_id, type, weight, source, properties
         FROM graph_relationships
         WHERE workspace_id = $1
           AND (source_id IN (${idList}) OR target_id IN (${idList}))`,
        [workspaceId, ...entityIds],
      );
      relationships = relResult.rows.map((r: Record<string, unknown>) => ({
        id: r['id'] as number,
        sourceId: r['source_id'] as number,
        targetId: r['target_id'] as number,
        type: r['type'] as string,
        weight: Number(r['weight']),
        source: r['source'] as 'structural' | 'claude' | 'auto',
        properties: r['properties'] as Record<string, unknown>,
      }));

      const obsResult = await this.pool.query(
        `SELECT id, entity_id, content, author, created_at
         FROM graph_observations
         WHERE workspace_id = $1 AND entity_id IN (${idList})`,
        [workspaceId, ...entityIds],
      );
      observations = obsResult.rows.map((r: Record<string, unknown>) => ({
        id: r['id'] as number,
        entityId: r['entity_id'] as number,
        content: r['content'] as string,
        author: r['author'] as string,
        createdAt: r['created_at'] as string,
      }));
    }

    return { entities, relationships, observations };
  }

  async getGraphStats(workspaceId: string): Promise<GraphStats> {
    const entityResult = await this.pool.query(
      `SELECT type, COUNT(*) as cnt FROM graph_entities WHERE workspace_id = $1 GROUP BY type`,
      [workspaceId],
    );
    const relResult = await this.pool.query(
      `SELECT type, COUNT(*) as cnt FROM graph_relationships WHERE workspace_id = $1 GROUP BY type`,
      [workspaceId],
    );
    const obsResult = await this.pool.query(
      `SELECT COUNT(*) as cnt FROM graph_observations WHERE workspace_id = $1`,
      [workspaceId],
    );

    const byEntityType: Record<string, number> = {};
    let entityCount = 0;
    for (const row of entityResult.rows as Record<string, unknown>[]) {
      const count = Number(row['cnt']);
      byEntityType[row['type'] as string] = count;
      entityCount += count;
    }

    const byRelationshipType: Record<string, number> = {};
    let relationshipCount = 0;
    for (const row of relResult.rows as Record<string, unknown>[]) {
      const count = Number(row['cnt']);
      byRelationshipType[row['type'] as string] = count;
      relationshipCount += count;
    }

    const firstRow = obsResult.rows[0] as Record<string, unknown> | undefined;
    const observationCount = Number(firstRow?.['cnt'] ?? 0);

    return { entityCount, relationshipCount, observationCount, byEntityType, byRelationshipType };
  }

  async clearGraph(workspaceId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM graph_relationships
       WHERE workspace_id = $1 AND source IN ('structural', 'auto')`,
      [workspaceId],
    );
    await this.pool.query(
      `DELETE FROM graph_entities
       WHERE workspace_id = $1
         AND id NOT IN (
           SELECT DISTINCT source_id FROM graph_relationships WHERE workspace_id = $1
           UNION SELECT DISTINCT target_id FROM graph_relationships WHERE workspace_id = $1
         )
         AND id NOT IN (SELECT DISTINCT entity_id FROM graph_observations WHERE workspace_id = $1)`,
      [workspaceId],
    );
  }
}
