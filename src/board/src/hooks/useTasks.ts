import { useState, useEffect, useCallback } from 'react';
import type { BoardData, BoardTask, SkillEvent } from '../types.js';

export function useTasks() {
  const [tasks, setTasks] = useState<BoardTask[]>([]);
  const [board, setBoard] = useState<BoardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [runningTasks, setRunningTasks] = useState<Map<string, string>>(new Map());

  const fetchBoard = useCallback(async () => {
    try {
      const res = await fetch('/api/board');
      const data = (await res.json()) as BoardData;
      setBoard(data);
      setTasks(data.tasks);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBoard();
  }, [fetchBoard]);

  const moveTask = useCallback(async (taskId: string, targetColumn: string) => {
    const res = await fetch('/api/tasks/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, targetColumn }),
    });

    const reader = res.body?.getReader();
    if (!reader) { return; }

    const decoder = new TextDecoder();
    let buffer = '';

    setRunningTasks((prev) => new Map(prev).set(taskId, ''));

    while (true) {
      const { done, value } = await reader.read();
      if (done) { break; }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) { continue; }
        const event = JSON.parse(line.slice(6)) as SkillEvent;

        if (event.type === 'output') {
          setRunningTasks((prev) => {
            const next = new Map(prev);
            next.set(taskId, (next.get(taskId) ?? '') + event.chunk);
            return next;
          });
        } else if (event.type === 'done') {
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? event.task : t)),
          );
          setRunningTasks((prev) => {
            const next = new Map(prev);
            next.delete(taskId);
            return next;
          });
        } else if (event.type === 'error') {
          setRunningTasks((prev) => {
            const next = new Map(prev);
            next.set(taskId, `Error: ${event.message}`);
            return next;
          });
        }
      }
    }
  }, []);

  return { tasks, board, loading, moveTask, runningTasks, refetch: fetchBoard };
}
