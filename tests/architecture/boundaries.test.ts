import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Import-boundary rules from CLAUDE.md and docs/architecture.md.
 * A directory that is missing or empty yields no files and passes trivially.
 */

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SRC = join(ROOT, 'src');
const SIM = join(SRC, 'simulation');
const OPT = join(SRC, 'optimization');
const BUS = join(SRC, 'business');

interface ImportRef {
  specifier: string;
  typeOnly: boolean;
  line: number;
}

function listSourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Collects static, re-export, side-effect, dynamic and require() module references. */
function collectImports(source: string): ImportRef[] {
  // Blank out block comments and full-line comments so examples in docs are not read as imports.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const refs: ImportRef[] = [];
  const lineOf = (index: number) => code.slice(0, index).split('\n').length;

  // The clause may not contain quotes, semicolons, colons, '=' or parentheses, so a match cannot run
  // from an export declaration into a later import statement.
  const fromRe = /(?:^|[\n;])[ \t]*(import|export)\s+(type\s+)?([^'";:=()]*?)\bfrom\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(fromRe)) {
    refs.push({ specifier: m[4], typeOnly: Boolean(m[2]), line: lineOf(m.index ?? 0) });
  }
  const sideEffectRe = /(?:^|[\n;])[ \t]*import\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(sideEffectRe)) {
    refs.push({ specifier: m[1], typeOnly: false, line: lineOf(m.index ?? 0) });
  }
  const dynamicRe = /\b(?:import|require)\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of code.matchAll(dynamicRe)) {
    refs.push({ specifier: m[1], typeOnly: false, line: lineOf(m.index ?? 0) });
  }
  return refs;
}

function isInside(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + sep);
}

interface Violation {
  file: string;
  line: number;
  message: string;
}

function checkFile(file: string, allowed: (ref: ImportRef, target: string | null) => string | null): Violation[] {
  const violations: Violation[] = [];
  const refs = collectImports(readFileSync(file, 'utf8'));
  for (const ref of refs) {
    const isRelative = ref.specifier.startsWith('./') || ref.specifier.startsWith('../') || ref.specifier === '.' || ref.specifier === '..';
    const target = isRelative ? resolve(dirname(file), ref.specifier) : null;
    const problem = allowed(ref, target);
    if (problem) violations.push({ file: file.slice(ROOT.length), line: ref.line, message: `${problem} ("${ref.specifier}")` });
  }
  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line} ${v.message}`).join('\n');
}

const FORBIDDEN_CALLS = /Math\.random|Date\.now|new Date\(/;

describe('architecture boundaries', () => {
  it('src/simulation imports only relative paths that stay inside src/simulation', () => {
    const violations = listSourceFiles(SIM).flatMap((file) =>
      checkFile(file, (_ref, target) => {
        if (target === null) return 'package or alias import not allowed in simulation';
        if (!isInside(target, SIM)) return 'simulation may only import from inside src/simulation';
        return null;
      }),
    );
    expect(formatViolations(violations)).toBe('');
  });

  it('src/optimization imports only from inside src/optimization or ../simulation', () => {
    const violations = listSourceFiles(OPT).flatMap((file) =>
      checkFile(file, (_ref, target) => {
        if (target === null) return 'package or alias import not allowed in optimization';
        if (isInside(target, OPT) || isInside(target, SIM)) return null;
        return 'optimization may only import from src/optimization or src/simulation';
      }),
    );
    expect(formatViolations(violations)).toBe('');
  });

  it('src/business imports from inside src/business, or type-only from src/simulation', () => {
    const violations = listSourceFiles(BUS).flatMap((file) =>
      checkFile(file, (ref, target) => {
        if (target === null) return 'package or alias import not allowed in business';
        if (isInside(target, BUS)) return null;
        if (isInside(target, SIM)) {
          return ref.typeOnly ? null : 'business may import from simulation only with "import type"';
        }
        return 'business may only import from src/business or type-only from src/simulation';
      }),
    );
    expect(formatViolations(violations)).toBe('');
  });

  it('no Math.random, Date.now or new Date() in simulation, optimization or business', () => {
    const violations: string[] = [];
    for (const file of [...listSourceFiles(SIM), ...listSourceFiles(OPT), ...listSourceFiles(BUS)]) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((text, idx) => {
        if (FORBIDDEN_CALLS.test(text)) violations.push(`${file.slice(ROOT.length)}:${idx + 1} ${text.trim()}`);
      });
    }
    expect(violations).toEqual([]);
  });
});
