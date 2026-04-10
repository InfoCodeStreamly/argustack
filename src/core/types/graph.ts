export interface GraphEntity {
  id?: number;
  name: string;
  type: string;
  properties: Record<string, unknown>;
}

export interface GraphRelationship {
  id?: number;
  sourceId: number;
  targetId: number;
  type: string;
  weight: number;
  source: 'structural' | 'claude' | 'auto';
  properties: Record<string, unknown>;
}

export interface GraphObservation {
  id?: number;
  entityId: number;
  content: string;
  author: string;
  createdAt?: string;
}

export interface GraphQueryResult {
  entities: GraphEntity[];
  relationships: GraphRelationship[];
  observations: GraphObservation[];
}

export interface GraphStats {
  entityCount: number;
  relationshipCount: number;
  observationCount: number;
  byEntityType: Record<string, number>;
  byRelationshipType: Record<string, number>;
}
