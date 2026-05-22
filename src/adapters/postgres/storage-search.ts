import type pg from 'pg';
import type { HybridSearchResult } from '../../core/types/index.js';

/**
 * Per-aggregate storage module: vector + hybrid search on issues
 * (embedding column on `issues`). Orchestrated by `PostgresStorage`.
 */
export class PostgresSearchStorage {
  constructor(private readonly pool: pg.Pool) {}

  async getUnembeddedIssueKeys(workspaceId: string, limit: number): Promise<string[]> {
    interface KeyRow {
      issue_key: string;
    }
    const result = await this.pool.query<KeyRow>(
      `SELECT issue_key FROM issues
       WHERE workspace_id = $1 AND embedding IS NULL
       ORDER BY updated DESC NULLS LAST LIMIT $2`,
      [workspaceId, limit],
    );
    return result.rows.map((r) => r.issue_key);
  }

  async saveEmbedding(workspaceId: string, issueKey: string, vector: number[]): Promise<void> {
    await this.pool.query(
      `UPDATE issues SET embedding = $1 WHERE workspace_id = $2 AND issue_key = $3`,
      [`[${vector.join(',')}]`, workspaceId, issueKey],
    );
  }

  async semanticSearch(
    workspaceId: string,
    vector: number[],
    limit: number,
    threshold?: number,
  ): Promise<{ issueKey: string; similarity: number }[]> {
    interface SimilarityRow {
      issue_key: string;
      similarity: number;
    }
    const vectorStr = `[${vector.join(',')}]`;
    const thresholdClause = threshold !== undefined
      ? `AND 1 - (embedding <=> $2::vector) >= ${String(threshold)}`
      : '';

    const result = await this.pool.query<SimilarityRow>(
      `SELECT issue_key, 1 - (embedding <=> $2::vector) AS similarity
       FROM issues
       WHERE workspace_id = $1 AND embedding IS NOT NULL ${thresholdClause}
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [workspaceId, vectorStr, limit],
    );

    return result.rows.map((r) => ({
      issueKey: r.issue_key,
      similarity: r.similarity,
    }));
  }

  async hybridSearch(
    workspaceId: string,
    query: string,
    vector: number[] | null,
    limit: number,
    threshold?: number,
  ): Promise<HybridSearchResult[]> {
    interface HybridRow {
      issue_key: string;
      score: number;
      in_text: boolean;
      in_vector: boolean;
    }

    const k = 60;
    const maxPerSource = limit * 2;
    const minSimilarity = threshold ?? 0.5;

    if (vector === null) {
      const result = await this.pool.query<HybridRow>(
        `SELECT issue_key,
                1.0 / (${String(k)} + ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $2)) DESC)) AS score,
                true AS in_text,
                false AS in_vector
         FROM issues
         WHERE workspace_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
         ORDER BY score DESC
         LIMIT $3`,
        [workspaceId, query, limit],
      );
      return result.rows.map((r) => ({
        issueKey: r.issue_key,
        score: r.score,
        source: 'text' as const,
      }));
    }

    const vectorStr = `[${vector.join(',')}]`;

    const result = await this.pool.query<HybridRow>(
      `WITH text_search AS (
         SELECT issue_key, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(search_vector, plainto_tsquery('english', $2)) DESC) AS rank
         FROM issues
         WHERE workspace_id = $1 AND search_vector @@ plainto_tsquery('english', $2)
         LIMIT $4
       ),
       vector_search AS (
         SELECT issue_key, ROW_NUMBER() OVER (ORDER BY embedding <=> $3::vector) AS rank
         FROM issues
         WHERE workspace_id = $1 AND embedding IS NOT NULL
           AND 1 - (embedding <=> $3::vector) >= ${String(minSimilarity)}
         LIMIT $4
       )
       SELECT COALESCE(t.issue_key, v.issue_key) AS issue_key,
              1.0 / (${String(k)} + COALESCE(t.rank, 1000)) + 1.0 / (${String(k)} + COALESCE(v.rank, 1000)) AS score,
              t.issue_key IS NOT NULL AS in_text,
              v.issue_key IS NOT NULL AS in_vector
       FROM text_search t
       FULL OUTER JOIN vector_search v ON t.issue_key = v.issue_key
       ORDER BY score DESC
       LIMIT $5`,
      [workspaceId, query, vectorStr, maxPerSource, limit],
    );

    return result.rows.map((r) => {
      let source: HybridSearchResult['source'];
      if (r.in_text && r.in_vector) {
        source = 'both';
      } else if (r.in_text) {
        source = 'text';
      } else {
        source = 'semantic';
      }
      return { issueKey: r.issue_key, score: r.score, source };
    });
  }
}
