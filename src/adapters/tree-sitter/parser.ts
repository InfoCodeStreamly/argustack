import { relative, sep } from 'node:path';
import Parser from 'tree-sitter';
import type { Tree, SyntaxNode } from 'tree-sitter';
import TS from 'tree-sitter-typescript';
import type { ICodeParser } from '../../core/ports/code-parser.js';
import type {
  CodeLanguage,
  CodeSymbol,
  CodeSymbolKind,
  CodeImport,
  ParsedFile,
  RawCallSite,
} from '../../core/types/code.js';

const TS_GRAMMAR = (TS as { typescript: unknown }).typescript;
const TSX_GRAMMAR = (TS as { tsx: unknown }).tsx;

const SYMBOL_NODE_KINDS: Record<string, CodeSymbolKind> = {
  function_declaration: 'function',
  class_declaration: 'class',
  method_definition: 'method',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
  enum_declaration: 'enum',
};

export interface TreeSitterParserOptions {
  projectRoot: string;
}

export class TreeSitterParser implements ICodeParser {
  readonly languages: readonly CodeLanguage[] = ['typescript', 'tsx', 'javascript', 'jsx'];
  private readonly projectRoot: string;
  private readonly tsParser: Parser;
  private readonly tsxParser: Parser;

  constructor(opts: TreeSitterParserOptions) {
    this.projectRoot = opts.projectRoot;
    this.tsParser = new Parser();
    this.tsParser.setLanguage(TS_GRAMMAR as Parameters<Parser['setLanguage']>[0]);
    this.tsxParser = new Parser();
    this.tsxParser.setLanguage(TSX_GRAMMAR as Parameters<Parser['setLanguage']>[0]);
  }

  parseFile(
    absPath: string,
    content: string,
    language: CodeLanguage,
  ): Promise<ParsedFile> {
    const parser = language === 'tsx' || language === 'jsx' ? this.tsxParser : this.tsParser;
    const bufferSize = Math.max(content.length + 1024, 32 * 1024);
    const tree: Tree = parser.parse(content, undefined, { bufferSize });
    const root = tree.rootNode;

    const relPath = relative(this.projectRoot, absPath).split(sep).join('/');
    const qnPrefix = relPath.replace(/\.[tj]sx?$/, '').replace(/\//g, '.');

    const symbols: CodeSymbol[] = [];
    const imports: CodeImport[] = [];
    const rawCalls: RawCallSite[] = [];

    this.walk(root, {
      filePath: relPath,
      qnPrefix,
      qnStack: [],
      symbols,
      imports,
      rawCalls,
    });

    return Promise.resolve({
      filePath: relPath,
      language,
      symbols,
      imports,
      rawCalls,
    });
  }

  private walk(
    node: SyntaxNode,
    ctx: WalkContext,
    currentSymbolQn: string | null = null,
  ): void {
    const kind = SYMBOL_NODE_KINDS[node.type];
    let nextSymbolQn = currentSymbolQn;
    let pushed = false;

    if (kind) {
      const name = extractName(node) ?? '<anonymous>';
      const qualifiedName = [ctx.qnPrefix, ...ctx.qnStack, name].join('.');
      ctx.qnStack.push(name);
      pushed = true;
      nextSymbolQn = qualifiedName;
      ctx.symbols.push({
        projectId: '',
        qualifiedName,
        name,
        kind,
        filePath: ctx.filePath,
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
      });
    } else if (
      node.type === 'lexical_declaration' &&
      (node.parent?.type === 'program' ||
        node.parent?.type === 'export_statement')
    ) {
      for (const declarator of childrenOfType(node, 'variable_declarator')) {
        const name = identifierText(declarator.childForFieldName('name'));
        if (!name) {continue;}
        ctx.symbols.push({
          projectId: '',
          qualifiedName: [ctx.qnPrefix, name].join('.'),
          name,
          kind: 'const',
          filePath: ctx.filePath,
          startLine: node.startPosition.row + 1,
          endLine: node.endPosition.row + 1,
        });
      }
    } else if (node.type === 'import_statement') {
      const fromFile = relativeImportTarget(node);
      if (fromFile) {
        const names = importedNames(node);
        ctx.imports.push({
          projectId: '',
          fromFile: ctx.filePath,
          toFile: fromFile,
          names,
        });
      }
    } else if (node.type === 'call_expression' && currentSymbolQn) {
      const callee = node.childForFieldName('function');
      if (callee) {
        const calleeText = callee.text;
        ctx.rawCalls.push({
          fromQn: currentSymbolQn,
          calleeText,
          line: node.startPosition.row + 1,
          column: node.startPosition.column,
        });
      }
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i);
      if (child) {
        this.walk(child, ctx, nextSymbolQn);
      }
    }

    if (pushed) {
      ctx.qnStack.pop();
    }
  }
}

interface WalkContext {
  filePath: string;
  qnPrefix: string;
  qnStack: string[];
  symbols: CodeSymbol[];
  imports: CodeImport[];
  rawCalls: RawCallSite[];
}

function extractName(node: SyntaxNode): string | null {
  const named = node.childForFieldName('name');
  return identifierText(named);
}

function identifierText(node: SyntaxNode | null): string | null {
  if (!node) {return null;}
  return node.text;
}

function childrenOfType(node: SyntaxNode, type: string): SyntaxNode[] {
  const out: SyntaxNode[] = [];
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i);
    if (child?.type === type) {
      out.push(child);
    }
  }
  return out;
}

function relativeImportTarget(node: SyntaxNode): string | null {
  const source = node.childForFieldName('source');
  if (!source) {return null;}
  const text = source.text.replace(/^['"`]|['"`]$/g, '');
  if (!text.startsWith('.')) {
    return null;
  }
  return text;
}

function importedNames(node: SyntaxNode): string[] {
  const names: string[] = [];
  const clause = node.namedChildren.find((c) => c.type === 'import_clause');
  if (!clause) {return names;}
  for (const child of clause.namedChildren) {
    if (child.type === 'identifier') {
      names.push(child.text);
    } else if (child.type === 'named_imports') {
      for (const spec of child.namedChildren) {
        if (spec.type === 'import_specifier') {
          const nameNode = spec.childForFieldName('name');
          if (nameNode) {names.push(nameNode.text);}
        }
      }
    } else if (child.type === 'namespace_import') {
      const alias = child.namedChildren.find((c) => c.type === 'identifier');
      if (alias) {names.push(`* as ${alias.text}`);}
    }
  }
  return names;
}
