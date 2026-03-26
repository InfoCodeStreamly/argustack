export type ColumnType = 'system' | 'skill';

export class BoardColumn {
  readonly name: string;
  readonly type: ColumnType;
  readonly displayName: string;

  constructor(name: string, type: ColumnType) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new Error('Column name cannot be empty');
    }
    this.name = trimmed;
    this.type = type;
    this.displayName = BoardColumn.toDisplayName(trimmed);
  }

  private static toDisplayName(name: string): string {
    return name
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  isSystem(): boolean {
    return this.type === 'system';
  }

  isSkill(): boolean {
    return this.type === 'skill';
  }

  skillName(): string | null {
    return this.type === 'skill' ? this.name : null;
  }

  equals(other: BoardColumn): boolean {
    return this.name === other.name && this.type === other.type;
  }

  toString(): string {
    return this.name;
  }
}
