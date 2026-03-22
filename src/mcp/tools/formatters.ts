export interface ReviewRow {
  pr_number: number;
  reviewer?: string;
  state?: string;
  submitted_at?: string;
}

export interface CommitFileRow {
  commit_hash: string;
  file_path?: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

export function groupReviewsByPr(
  rows: Record<string, unknown>[]
): Map<number, ReviewRow[]> {
  const map = new Map<number, ReviewRow[]>();
  for (const r of rows as unknown as ReviewRow[]) {
    const arr = map.get(r.pr_number) ?? [];
    arr.push(r);
    map.set(r.pr_number, arr);
  }
  return map;
}

export function groupFilesByCommit(
  rows: Record<string, unknown>[]
): Map<string, CommitFileRow[]> {
  const map = new Map<string, CommitFileRow[]>();
  for (const f of rows as unknown as CommitFileRow[]) {
    const arr = map.get(f.commit_hash) ?? [];
    arr.push(f);
    map.set(f.commit_hash, arr);
  }
  return map;
}
