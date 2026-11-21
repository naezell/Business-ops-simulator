import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { companyCsvTemplates, exportCompany, importCompany } from '@/services/company-files';
import { selectExportAssumedPaths, selectHasUserWork, useStore } from '@/services/store';
import { Button, Notice } from './ui';

function download(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const LIST_FILES = ['customers', 'employees'] as const;
const FILE_LABELS = { customers: 'Customers CSV', employees: 'Employees CSV' };
type ImportResult = ReturnType<typeof importCompany>;

export function CompanyTemplateButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      {LIST_FILES.map((key) => (
        <Button key={key} size="sm" onClick={() => download(companyCsvTemplates[key], `${key}-template.csv`, 'text/csv;charset=utf-8')}>
          Download {FILE_LABELS[key]} template
        </Button>
      ))}
    </div>
  );
}

function CompanyImportDialog({ close, openGuide, onImported }: { close: () => void; openGuide: () => void; onImported: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasWork = useStore(selectHasUserWork);
  const savedCompanyName = useStore((s) => s.userCompany?.company.name);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  function clearReview() {
    setResult(null);
    setFileError(null);
  }

  async function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = new FormData(event.currentTarget);
    clearReview();
    setBusy(true);
    const [json, customers, employees] = await Promise.allSettled(
      (['company', ...LIST_FILES] as const).map(async (key) => {
        const file = files.get(key);
        return file instanceof File && file.name !== '' ? file.text() : undefined;
      }),
    );
    setBusy(false);
    if (json.status === 'rejected' || customers.status === 'rejected' || employees.status === 'rejected') {
      const failed = [json, customers, employees].flatMap((read, i) =>
        read.status === 'rejected' ? [['Company JSON', FILE_LABELS.customers, FILE_LABELS.employees][i]] : [],
      );
      setFileError(`Could not read ${failed.join(', ')}. Select the files again and retry.`);
      return;
    }
    setResult(importCompany(json.value ?? '', { customers: customers.value, employees: employees.value }));
  }

  function accept() {
    if (!result?.ok) return;
    try {
      useStore.getState().setUserCompany(result.company, result.assumedPaths);
      onImported();
    } catch (error) {
      setFileError(error instanceof Error ? error.message : 'Could not save the imported company.');
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-auto rounded-xl border border-line bg-surface text-ink shadow-xl backdrop:bg-black/35"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="space-y-4 p-4 sm:p-6">
        <div>
          <h2 id={titleId} className="text-lg font-semibold">Import company</h2>
          <p className="mt-1 text-sm text-muted">Your files are read and saved in this browser.</p>
        </div>
        <Button variant="ghost" size="sm" onClick={openGuide}>Open the company file guide</Button>
        <form onSubmit={review} className="space-y-3" aria-busy={busy}>
          <fieldset disabled={busy} className="space-y-3">
            <label className="block text-[13px] font-medium">
              Company JSON (required)
              <input name="company" type="file" accept=".json,application/json" autoFocus required onChange={clearReview} className="mt-1 block w-full text-[13px] text-muted file:mr-2 file:rounded file:border file:border-line file:bg-sunken file:px-2 file:py-1 file:text-ink" />
            </label>
            <p className="text-[13px] text-muted">A CSV replaces the entire matching list in the JSON.</p>
            {LIST_FILES.map((key) => (
              <label key={key} className="block text-[13px] font-medium">
                {FILE_LABELS[key]} (optional)
                <input name={key} type="file" accept=".csv,text/csv" onChange={clearReview} className="mt-1 block w-full text-[13px] text-muted file:mr-2 file:rounded file:border file:border-line file:bg-sunken file:px-2 file:py-1 file:text-ink" />
              </label>
            ))}
          </fieldset>
          <CompanyTemplateButtons />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" variant={result?.ok ? 'secondary' : 'primary'} disabled={busy}>
              {busy ? 'Reading files…' : 'Check files'}
            </Button>
            <Button onClick={close}>Cancel</Button>
          </div>
        </form>
        {fileError && <Notice tone="error">{fileError}</Notice>}
        {result && result.issues.length > 0 && (
          <Notice tone={result.ok ? 'warn' : 'error'}>
            <p className="font-medium">{result.ok ? 'Review these warnings before importing.' : 'Correct these issues and check the files again.'}</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              {result.issues.map((issue, i) => (
                <li key={i} className="wrap-anywhere">
                  <code className="font-medium">{issue.path}</code> · {issue.message}
                </li>
              ))}
            </ul>
          </Notice>
        )}
        {result?.ok && (
          <div className="space-y-2 rounded-md border border-line bg-sunken p-3 text-[13px]">
            <p role="status" className="wrap-anywhere"><strong>{result.company.name}</strong> is ready to import.</p>
            {result.assumedPaths.length > 0 && (
              <details className="text-muted">
                <summary className="cursor-pointer">{result.assumedPaths.length} fields use illustrative industry assumptions</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  {result.assumedPaths.map((path) => <li key={path} className="wrap-anywhere"><code>{path}</code></li>)}
                </ul>
              </details>
            )}
            {savedCompanyName && <p className="wrap-anywhere">This replaces the saved company, <strong>{savedCompanyName}</strong>.</p>}
            {hasWork && <p>This clears the current company’s draft, adopted decisions, conditions and edits.</p>}
            <Button variant="primary" onClick={accept} disabled={busy}>Import company</Button>
          </div>
        )}
      </div>
    </dialog>
  );
}

export function CompanyFileControls({ openGuide, onImported }: { openGuide: () => void; onImported: () => void }) {
  const [importOpen, setImportOpen] = useState(false);
  const close = () => setImportOpen(false);
  function downloadCompany() {
    const state = useStore.getState();
    const filename = state.company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    download(exportCompany(state.company, selectExportAssumedPaths(state)), `${filename || 'company'}.json`, 'application/json;charset=utf-8');
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" onClick={() => setImportOpen(true)}>Import company</Button>
      <Button size="sm" onClick={downloadCompany}>Export company</Button>
      {importOpen && (
        <CompanyImportDialog
          close={close}
          openGuide={() => { close(); openGuide(); }}
          onImported={() => { close(); onImported(); }}
        />
      )}
    </div>
  );
}
