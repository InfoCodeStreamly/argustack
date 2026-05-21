import type { IPlatformProbe } from '../../core/ports/platform-probe.js';
import type { IDockerControl, DockerVersion } from '../../core/ports/docker-control.js';

export type CheckVersionsFailure =
  | { kind: 'node-too-old'; current: string; required: string }
  | { kind: 'docker-missing' }
  | { kind: 'docker-too-old'; current: string; required: string }
  | { kind: 'compose-v1'; current: string };

export type CheckVersionsResult =
  | { ok: true; node: string; docker: DockerVersion | null }
  | { ok: false; failure: CheckVersionsFailure; node: string };

const MIN_NODE_MAJOR = 18;
const MIN_DOCKER_MAJOR = 20;
const MIN_COMPOSE_MAJOR = 2;

/**
 * Check minimum versions of node + docker + compose required by argustack.
 * Returns a typed failure when something is out of date so callers can
 * surface a precise error.
 */
export class CheckVersionsUseCase {
  constructor(
    private readonly platform: IPlatformProbe,
    private readonly docker: IDockerControl,
  ) {}

  async execute(): Promise<CheckVersionsResult> {
    void this.platform;
    const node = process.versions.node;
    const nodeMajor = Number(node.split('.')[0] ?? '0');
    if (nodeMajor < MIN_NODE_MAJOR) {
      return {
        ok: false,
        node,
        failure: { kind: 'node-too-old', current: node, required: `${String(MIN_NODE_MAJOR)}.0` },
      };
    }

    const dockerInstalled = await this.docker.isInstalled();
    if (!dockerInstalled) {
      return { ok: false, node, failure: { kind: 'docker-missing' } };
    }

    const version = await this.docker.version();
    if (!version) {
      return { ok: true, node, docker: null };
    }

    const engineMajor = Number(version.engine.split('.')[0] ?? '0');
    if (engineMajor < MIN_DOCKER_MAJOR) {
      return {
        ok: false,
        node,
        failure: { kind: 'docker-too-old', current: version.engine, required: `${String(MIN_DOCKER_MAJOR)}.0` },
      };
    }

    const composeMajor = Number(version.compose.split('.')[0] ?? '0');
    if (composeMajor < MIN_COMPOSE_MAJOR) {
      return { ok: false, node, failure: { kind: 'compose-v1', current: version.compose } };
    }

    return { ok: true, node, docker: version };
  }
}
