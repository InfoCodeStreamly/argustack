import type { IOllamaControl, InstallResult } from '../../core/ports/ollama-control.js';
import type { IPlatformProbe } from '../../core/ports/platform-probe.js';

export type InstallOllamaFailureKind =
  | 'unsupported-os'
  | 'no-brew-no-curl'
  | 'brew-failed'
  | 'curl-failed';

export type InstallOllamaResult =
  | { ok: true; via: 'brew' | 'curl' }
  | { ok: false; kind: InstallOllamaFailureKind; details: string };

/**
 * Install Ollama using whatever package manager is appropriate for
 * the current OS. macOS tries `brew install ollama` first, falls back
 * to `curl install.sh` if brew is missing or fails. Linux uses
 * `curl install.sh` directly. Windows is rejected (caller should show
 * the manual link).
 */
export class InstallOllamaUseCase {
  constructor(
    private readonly ollama: IOllamaControl,
    private readonly platform: IPlatformProbe,
  ) {}

  async execute(): Promise<InstallOllamaResult> {
    const os = this.platform.detectOS();
    if (os === 'windows' || os === 'unknown') {
      return { ok: false, kind: 'unsupported-os', details: `OS=${os}` };
    }

    if (os === 'macos') {
      const brewResult = await this.tryBrew();
      if (brewResult) {
        return brewResult;
      }
    }
    return this.tryCurl();
  }

  private async tryBrew(): Promise<InstallOllamaResult | null> {
    const has = await this.platform.hasCommand('brew');
    if (!has) {
      return null;
    }
    const result: InstallResult = await this.ollama.installViaBrew();
    if (result.ok) {
      return { ok: true, via: 'brew' };
    }
    return { ok: false, kind: 'brew-failed', details: result.details };
  }

  private async tryCurl(): Promise<InstallOllamaResult> {
    const has = await this.platform.hasCommand('curl');
    if (!has) {
      return { ok: false, kind: 'no-brew-no-curl', details: 'curl not installed' };
    }
    const result = await this.ollama.installViaCurl();
    if (result.ok) {
      return { ok: true, via: 'curl' };
    }
    return { ok: false, kind: 'curl-failed', details: result.details };
  }
}
