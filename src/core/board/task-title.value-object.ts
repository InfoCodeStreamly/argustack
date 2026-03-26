const MAX_LENGTH = 200;

export class TaskTitle {
  readonly value: string;

  constructor(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) {
      throw new Error('Task title cannot be empty');
    }
    this.value = trimmed.length > MAX_LENGTH
      ? trimmed.slice(0, MAX_LENGTH)
      : trimmed;
  }

  equals(other: TaskTitle): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
