import type { ValidationIssue } from '@/simulation';
import { importError } from './company-file-schema';

export type CompanyCsvList = 'customers' | 'employees';

const columns = {
  customers: ['id', 'name', 'x', 'y', 'sizeFactor', 'recurringJobTypeId', 'phase'],
  employees: ['id', 'name', 'hourlyWage', 'skill', 'productivity', 'crewId', 'tenureDays'],
} as const;

export const companyCsvTemplates: Record<CompanyCsvList, string> = {
  customers: columns.customers.join(',') + '\r\n',
  employees: columns.employees.join(',') + '\r\n',
};

interface CsvRow {
  line: number;
  cells: string[];
}

/** Read standard comma-delimited CSV including escaped quotes and multiline cells. */
function readRows(text: string, filename: string, issues: ValidationIssue[]): CsvRow[] {
  const rows: CsvRow[] = [];
  let line = 1;
  let startLine = 1;
  let cells: string[] = [];
  let cell = '';
  let state: 'start' | 'unquoted' | 'quoted' | 'closed' = 'start';

  function finishCell() {
    cells.push(cell);
    cell = '';
    state = 'start';
  }

  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  for (let index = 0; index <= text.length; index++) {
    const char = text[index];
    if (state === 'quoted') {
      if (char === undefined) {
        issues.push(importError(`${filename} row ${startLine}`, 'Unclosed quoted cell.'));
        break;
      }
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index++;
        } else state = 'closed';
      } else {
        cell += char;
        if (char === '\n') line++;
      }
    } else if (char === undefined || char === '\n') {
      finishCell();
      if (cells.length > 1 || cells[0].trim() !== '') rows.push({ line: startLine, cells });
      cells = [];
      startLine = ++line;
    } else if (char === ',') {
      finishCell();
    } else if (char === '"' && state === 'start') {
      state = 'quoted';
    } else {
      if (char === '"' || state === 'closed') {
        issues.push(importError(`${filename} row ${startLine}`, 'Quote the entire cell and double any quotes inside it.'));
      }
      cell += char;
      state = 'unquoted';
    }
  }
  return rows;
}

const numericColumns = new Set(['x', 'y', 'sizeFactor', 'phase', 'hourlyWage', 'skill', 'productivity', 'tenureDays']);
const optionalColumns = new Set(['sizeFactor', 'phase', 'productivity']);
const nullableColumns = new Set(['crewId', 'recurringJobTypeId']);
const decimal = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function readCompanyCsv(list: CompanyCsvList, text: string, issues: ValidationIssue[]) {
  const filename = `${list}.csv`;
  const expected: readonly string[] = columns[list];
  const [header, ...rows] = readRows(text, filename, issues);
  if (!header) {
    issues.push(importError(`${filename} row 1`, 'Missing header. Download the CSV template for the column names.'));
    return { entries: [], sourceRows: [] };
  }
  const keys = header.cells.map((cell) => cell.trim());
  const headerPath = `${filename} row ${header.line}`;
  for (const key of expected) if (!optionalColumns.has(key) && !keys.includes(key)) {
    issues.push(importError(headerPath, `Missing column "${key}".`));
  }
  const seen = new Set<string>();
  for (const key of keys) {
    if (!expected.includes(key)) issues.push(importError(headerPath, `Unknown column "${key}".`));
    if (seen.has(key)) issues.push(importError(headerPath, `Duplicate column "${key}".`));
    seen.add(key);
  }

  const entries = rows.map(({ line, cells }) => {
    if (cells.length !== keys.length) issues.push(importError(`${filename} row ${line}`, `Expected ${keys.length} cells, got ${cells.length}.`));
    const entry = new Map<string, string | number | null>();
    for (const [index, key] of keys.entries()) {
      if (!expected.includes(key) || entry.has(key) || index >= cells.length) continue;
      const cell = cells[index].trim();
      if (cell === '' && optionalColumns.has(key)) continue;
      if (cell === '' && nullableColumns.has(key)) entry.set(key, null);
      else if (numericColumns.has(key) && decimal.test(cell)) entry.set(key, Number(cell));
      else entry.set(key, cell);
    }
    return Object.fromEntries(entry);
  });
  return { entries, sourceRows: rows.map((row) => row.line) };
}
