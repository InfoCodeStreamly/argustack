import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import chalk from 'chalk';
import { SqlJsBoardStore } from '../adapters/board/store.js';
import { ClaudeSkillRunner } from '../adapters/board/skill-runner.js';
import { discoverSkills } from '../adapters/board/skill-discovery.js';
import { MoveTaskUseCase } from '../use-cases/move-task.js';
import { SyncBoardUseCase } from '../use-cases/sync-board.js';
import type { BoardTaskData } from '../core/types/board.js';
import type { PipelineConfig } from '../core/board/pipeline.value-object.js';

interface BoardApi {
  tasks: BoardTaskData[];
  pipeline: PipelineConfig;
  skills: { name: string; description: string; source: string }[];
  claudeAvailable: boolean;
}

export async function startBoardServer(wsRoot: string, port: number): Promise<void> {
  const store = new SqlJsBoardStore(wsRoot);
  await store.initialize();

  const skillRunner = new ClaudeSkillRunner();
  const moveTask = new MoveTaskUseCase(store, skillRunner);
  const syncBoard = new SyncBoardUseCase(store);

  const projectDir = resolve(wsRoot, '..');
  const skills = discoverSkills(projectDir);
  const skillNames = skills.map((s) => s.name);

  const tasksDir = join(wsRoot, 'Docs', 'Tasks');
  await syncBoard.execute(tasksDir, skillNames);

  const claudeAvailable = await skillRunner.isAvailable();

  const server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url ?? '/', `http://localhost:${String(port)}`);

    if (url.pathname === '/api/board' && req.method === 'GET') {
      const boardData = await syncBoard.execute(tasksDir, skillNames);
      const data: BoardApi = {
        tasks: boardData.tasks,
        pipeline: boardData.pipeline,
        skills: skills.map((s) => ({ name: s.name, description: s.description, source: s.source })),
        claudeAvailable,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
      return;
    }

    if (url.pathname === '/api/tasks/move' && req.method === 'POST') {
      const body = await readBody(req);
      const { taskId, targetColumn } = JSON.parse(body) as { taskId: string; targetColumn: string };

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      try {
        const result = await moveTask.execute(
          { taskId, targetColumn },
          (chunk) => {
            res.write(`data: ${JSON.stringify({ type: 'output', chunk })}\n\n`);
          },
        );
        res.write(`data: ${JSON.stringify({ type: 'done', task: result.task, skillTriggered: result.skillTriggered })}\n\n`);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        res.write(`data: ${JSON.stringify({ type: 'error', message })}\n\n`);
      }
      res.end();
      return;
    }

    if (url.pathname === '/api/pipeline' && req.method === 'PUT') {
      const body = await readBody(req);
      const config = JSON.parse(body) as PipelineConfig;
      await store.savePipeline(config);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    serveSpa(req, res, url.pathname);
  })(); });

  server.listen(port, () => {
    console.log('');
    console.log(chalk.bold('  Argustack Board'));
    console.log(`  ${chalk.cyan(`http://localhost:${String(port)}`)}`);
    console.log('');
    console.log(`  Workspace: ${wsRoot}`);
    console.log(`  Skills: ${String(skills.length)} discovered (${skills.map((s) => s.name).join(', ')})`);
    console.log(`  Claude CLI: ${claudeAvailable ? chalk.green('available') : chalk.yellow('not found — skill execution disabled')}`);
    console.log('');
    console.log(chalk.dim('  Press Ctrl+C to stop'));
    console.log('');
  });

  const cleanup = async (): Promise<void> => {
    console.log(chalk.dim('\n  Shutting down...'));
    await store.close();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void cleanup(); });
  process.on('SIGTERM', () => { void cleanup(); });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    const chunks: string[] = [];
    req.setEncoding('utf-8');
    req.on('data', (chunk: string) => chunks.push(chunk));
    req.on('end', () => { done(chunks.join('')); });
    req.on('error', fail);
  });
}

function serveSpa(
  _req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): void {
  const currentFile = fileURLToPath(import.meta.url);
  const boardDistDir = join(dirname(currentFile), '..', 'board');

  let filePath = join(boardDistDir, pathname === '/' ? 'index.html' : pathname);

  if (!existsSync(filePath)) {
    filePath = join(boardDistDir, 'index.html');
  }

  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Board UI not built. Run: npm run build:board');
    return;
  }

  const ext = filePath.split('.').pop() ?? '';
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    js: 'application/javascript',
    css: 'text/css',
    svg: 'image/svg+xml',
    png: 'image/png',
    json: 'application/json',
  };

  res.writeHead(200, { 'Content-Type': mimeTypes[ext] ?? 'application/octet-stream' });
  res.end(readFileSync(filePath));
}
