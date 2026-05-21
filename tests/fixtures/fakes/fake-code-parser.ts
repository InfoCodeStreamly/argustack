import type { ICodeParser } from '../../../src/core/ports/code-parser.js';
import type {
  CodeLanguage,
  ParsedFile,
} from '../../../src/core/types/code.js';

export class FakeCodeParser implements ICodeParser {
  readonly languages: readonly CodeLanguage[] = ['typescript', 'tsx', 'javascript', 'jsx'];

  private readonly results = new Map<string, ParsedFile>();
  readonly parseCalls: { absPath: string; language: CodeLanguage }[] = [];

  setFileResult(absPath: string, parsed: ParsedFile): void {
    this.results.set(absPath, parsed);
  }

  parseFile(
    absPath: string,
    _content: string,
    language: CodeLanguage,
  ): Promise<ParsedFile> {
    this.parseCalls.push({ absPath, language });
    const result = this.results.get(absPath);
    if (result) {return Promise.resolve(result);}
    return Promise.resolve({
      filePath: absPath,
      language,
      symbols: [],
      imports: [],
      rawCalls: [],
    });
  }

  clear(): void {
    this.results.clear();
    this.parseCalls.length = 0;
  }
}
