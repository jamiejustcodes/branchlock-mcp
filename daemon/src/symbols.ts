import fs from 'node:fs';
import path from 'node:path';
import type { ExtractedSymbol, SymbolWarning } from '@branchlock/shared';

// ─── Symbol Extraction (Regex-based heuristic) ───────────────
// This is a name-overlap heuristic, NOT full semantic analysis.
// It extracts top-level exported symbols from TypeScript/Python files
// and checks for import references across files locked by different agents.

// ─── TypeScript / JavaScript Patterns ─────────────────────────

const TS_PATTERNS: Array<{
  regex: RegExp;
  kind: ExtractedSymbol['kind'];
}> = [
  // export function foo(
  { regex: /^export\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
  // export default function foo(
  { regex: /^export\s+default\s+(?:async\s+)?function\s+(\w+)/gm, kind: 'function' },
  // export class Foo
  { regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/gm, kind: 'class' },
  // export default class Foo
  { regex: /^export\s+default\s+class\s+(\w+)/gm, kind: 'class' },
  // export interface Foo
  { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface' },
  // export type Foo
  { regex: /^export\s+type\s+(\w+)/gm, kind: 'type' },
  // export enum Foo
  { regex: /^export\s+enum\s+(\w+)/gm, kind: 'enum' },
  // export const/let/var foo
  { regex: /^export\s+(?:const|let|var)\s+(\w+)/gm, kind: 'variable' },
  // export default Foo (bare identifier)
  { regex: /^export\s+default\s+(\w+)\s*;?\s*$/gm, kind: 'variable' },
  // module.exports.foo = or exports.foo =
  { regex: /^(?:module\.)?exports\.(\w+)\s*=/gm, kind: 'variable' },
];

// Patterns to extract import references (what symbols a file imports)
const TS_IMPORT_PATTERNS: RegExp[] = [
  // import { foo, bar } from '...'
  /import\s+\{([^}]+)\}\s+from\s+['"][^'"]+['"]/g,
  // import foo from '...'
  /import\s+(\w+)\s+from\s+['"][^'"]+['"]/g,
  // const { foo } = require('...')
  /const\s+\{([^}]+)\}\s*=\s*require\s*\(/g,
];

// ─── Python Patterns ──────────────────────────────────────────

const PY_PATTERNS: Array<{
  regex: RegExp;
  kind: ExtractedSymbol['kind'];
}> = [
  // def foo(
  { regex: /^def\s+(\w+)\s*\(/gm, kind: 'function' },
  // async def foo(
  { regex: /^async\s+def\s+(\w+)\s*\(/gm, kind: 'function' },
  // class Foo(
  { regex: /^class\s+(\w+)/gm, kind: 'class' },
  // FOO = ... (module-level constants, uppercase)
  { regex: /^([A-Z_][A-Z_0-9]+)\s*=/gm, kind: 'variable' },
];

const PY_IMPORT_PATTERNS: RegExp[] = [
  // from module import foo, bar
  /from\s+\S+\s+import\s+(.+)/g,
  // import foo
  /^import\s+(\w+)/gm,
];

// ─── Main Extraction Function ─────────────────────────────────

export function extractSymbols(filePath: string): ExtractedSymbol[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const symbols: ExtractedSymbol[] = [];
  const seen = new Set<string>();

  const patterns = getPatterns(ext);

  for (const { regex, kind } of patterns) {
    // Reset regex lastIndex for each use
    const r = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = r.exec(content)) !== null) {
      const name = match[1].trim();
      if (name && !seen.has(name)) {
        seen.add(name);

        // Calculate line number
        const line = content.substring(0, match.index).split('\n').length;

        symbols.push({
          name,
          kind,
          exported: true,
          line,
        });
      }
    }
  }

  return symbols;
}

/**
 * Extract the symbol names that a file imports / references.
 */
export function extractImportedSymbols(filePath: string): string[] {
  if (!fs.existsSync(filePath)) return [];

  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  const names: string[] = [];
  const seen = new Set<string>();

  const importPatterns = getImportPatterns(ext);

  for (const regex of importPatterns) {
    const r = new RegExp(regex.source, regex.flags);
    let match: RegExpExecArray | null;
    while ((match = r.exec(content)) !== null) {
      const raw = match[1];
      // Split by comma (for destructured imports like { foo, bar })
      const parts = raw.split(',').map((s) => s.trim().split(/\s+as\s+/)[0].trim());
      for (const part of parts) {
        if (part && /^\w+$/.test(part) && !seen.has(part)) {
          seen.add(part);
          names.push(part);
        }
      }
    }
  }

  return names;
}

function getPatterns(ext: string) {
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mts':
    case '.mjs':
    case '.cts':
    case '.cjs':
      return TS_PATTERNS;
    case '.py':
      return PY_PATTERNS;
    default:
      return TS_PATTERNS; // Default to TS patterns
  }
}

function getImportPatterns(ext: string): RegExp[] {
  switch (ext) {
    case '.py':
      return PY_IMPORT_PATTERNS;
    default:
      return TS_IMPORT_PATTERNS;
  }
}

// ─── Overlap Detection ───────────────────────────────────────

interface LockedFileInfo {
  filePath: string;
  agentId: string;
  symbols: ExtractedSymbol[];
}

/**
 * Check if a newly claimed file's imports reference symbols from
 * files locked by other agents. Returns soft warnings, not hard blocks.
 *
 * This is a name-overlap heuristic — it checks if any imported name
 * matches an exported symbol in a file locked by another agent.
 * False positives are possible (e.g., common names like 'config').
 */
export function detectSymbolOverlaps(
  newFile: string,
  newAgent: string,
  lockedFiles: LockedFileInfo[]
): SymbolWarning[] {
  const warnings: SymbolWarning[] = [];

  // Get what the new file imports
  const importedNames = extractImportedSymbols(newFile);
  if (importedNames.length === 0) return warnings;

  // Check against symbols exported by files locked by other agents
  for (const locked of lockedFiles) {
    if (locked.agentId === newAgent) continue; // Skip own locks

    for (const symbol of locked.symbols) {
      if (importedNames.includes(symbol.name)) {
        const shortNew = path.basename(newFile);
        const shortLocked = path.basename(locked.filePath);
        warnings.push({
          sourceFile: newFile,
          sourceAgent: newAgent,
          targetFile: locked.filePath,
          targetAgent: locked.agentId,
          symbolName: symbol.name,
          message: `${shortNew} imports "${symbol.name}" from ${shortLocked}, currently locked by ${locked.agentId}`,
        });
      }
    }
  }

  return warnings;
}
