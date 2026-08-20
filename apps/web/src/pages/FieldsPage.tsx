import { FIELD_INPUT_TYPES } from '@approvex/shared';
import { useEffect, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { LedgerTable } from '../components/LedgerTable';
import { Button, Input, Select } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import type { FieldDefinition } from '../lib/types';

const EMPTY_DRAFT = {
  name: '',
  type: 'string',
  description: '',
  source: 'payload',
  lookupUrl: '',
  lookupFallback: 'treat_as_no_match',
  // P0.1 Request Portal — collect the field on the generated request form.
  userSubmittable: false,
  label: '',
  helpText: '',
  inputType: '',
  displayOrder: '',
  contexts: '',
};

/** Split a comma-separated contexts input into a clean, de-duped list. */
function parseContexts(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean),
    ),
  ];
}

export function FieldsPage(): React.JSX.Element {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const { can } = useAuth();

  const load = (): void => {
    api<{ items: FieldDefinition[] }>('/fields')
      .then((res) => setFields(res.items))
      .catch(() => setError("Couldn't load fields. Check your connection and retry."))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const add = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const contexts = parseContexts(draft.contexts);
    try {
      await api('/fields', {
        method: 'POST',
        body: {
          name: draft.name,
          type: draft.type,
          ...(draft.description ? { description: draft.description } : {}),
          ...(draft.source !== 'payload' ? { source: draft.source } : {}),
          ...(draft.source === 'looked_up'
            ? { lookupUrl: draft.lookupUrl, lookupFallback: draft.lookupFallback }
            : {}),
          ...(draft.userSubmittable
            ? {
                userSubmittable: true,
                ...(draft.label ? { label: draft.label } : {}),
                ...(draft.helpText ? { helpText: draft.helpText } : {}),
                ...(draft.inputType ? { inputType: draft.inputType } : {}),
                ...(draft.displayOrder !== '' ? { displayOrder: Number(draft.displayOrder) } : {}),
                ...(contexts.length ? { contexts } : {}),
              }
            : {}),
        },
      });
      setDraft(EMPTY_DRAFT);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add the field.');
    }
  };

  const remove = async (id: string): Promise<void> => {
    await api(`/fields/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <>
      <PageHeader title="Fields" />
      <p className="mb-4 max-w-2xl text-base text-ink-soft">
        The field registry drives builder dropdowns and type handling: a numeric string in a payload
        compares numerically only when its field is registered as a number here.
      </p>
      {can('rule:create') && (
        <form onSubmit={(e) => void add(e)} className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="fname" className="mb-1 block text-sm font-medium text-ink-soft">
                Field path
              </label>
              <Input
                id="fname"
                className="w-52 font-mono text-sm"
                placeholder="vendor.country"
                required
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="ftype" className="mb-1 block text-sm font-medium text-ink-soft">
                Type
              </label>
              <Select
                id="ftype"
                value={draft.type}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="date">date</option>
              </Select>
            </div>
            <div>
              <label htmlFor="fsource" className="mb-1 block text-sm font-medium text-ink-soft">
                Source
              </label>
              <Select
                id="fsource"
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
              >
                <option value="payload">payload</option>
                <option value="computed">computed</option>
                <option value="looked_up">looked_up</option>
              </Select>
            </div>
            {draft.source === 'looked_up' && (
              <>
                <div>
                  <label htmlFor="flookup" className="mb-1 block text-sm font-medium text-ink-soft">
                    Lookup URL
                  </label>
                  <Input
                    id="flookup"
                    type="url"
                    required
                    className="w-64 font-mono text-sm"
                    placeholder="https://api.example.com/vendors/{value}"
                    value={draft.lookupUrl}
                    onChange={(e) => setDraft({ ...draft, lookupUrl: e.target.value })}
                  />
                </div>
                <div>
                  <label
                    htmlFor="ffallback"
                    className="mb-1 block text-sm font-medium text-ink-soft"
                  >
                    On lookup failure
                  </label>
                  <Select
                    id="ffallback"
                    value={draft.lookupFallback}
                    onChange={(e) => setDraft({ ...draft, lookupFallback: e.target.value })}
                  >
                    <option value="treat_as_no_match">treat as no match</option>
                    <option value="use_cached_value">use cached value</option>
                    <option value="block_and_alert">block and alert</option>
                  </Select>
                </div>
              </>
            )}
            <div className="flex-1">
              <label htmlFor="fdesc" className="mb-1 block text-sm font-medium text-ink-soft">
                Description
              </label>
              <Input
                id="fdesc"
                placeholder="Optional"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </div>
            <Button type="submit" variant="primary">
              Add field
            </Button>
          </div>
          <div className="rounded-[8px] border border-rule bg-paper px-3 py-2">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 accent-brand"
                checked={draft.userSubmittable}
                onChange={(e) => setDraft({ ...draft, userSubmittable: e.target.checked })}
              />
              Collect this field on the request form
            </label>
            {draft.userSubmittable && (
              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div>
                  <label htmlFor="flabel" className="mb-1 block text-sm font-medium text-ink-soft">
                    Form label
                  </label>
                  <Input
                    id="flabel"
                    className="w-44 text-sm"
                    placeholder={draft.name || 'Vendor country'}
                    value={draft.label}
                    onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                  />
                </div>
                <div>
                  <label htmlFor="finput" className="mb-1 block text-sm font-medium text-ink-soft">
                    Input control
                  </label>
                  <Select
                    id="finput"
                    value={draft.inputType}
                    onChange={(e) => setDraft({ ...draft, inputType: e.target.value })}
                  >
                    <option value="">auto ({draft.type})</option>
                    {FIELD_INPUT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label htmlFor="forder" className="mb-1 block text-sm font-medium text-ink-soft">
                    Order
                  </label>
                  <Input
                    id="forder"
                    type="number"
                    min={0}
                    className="w-20 text-sm"
                    placeholder="0"
                    value={draft.displayOrder}
                    onChange={(e) => setDraft({ ...draft, displayOrder: e.target.value })}
                  />
                </div>
                <div>
                  <label
                    htmlFor="fcontexts"
                    className="mb-1 block text-sm font-medium text-ink-soft"
                  >
                    Contexts
                  </label>
                  <Input
                    id="fcontexts"
                    className="w-52 font-mono text-sm"
                    placeholder="all forms (or expense, travel)"
                    value={draft.contexts}
                    onChange={(e) => setDraft({ ...draft, contexts: e.target.value })}
                  />
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <label htmlFor="fhelp" className="mb-1 block text-sm font-medium text-ink-soft">
                    Help text
                  </label>
                  <Input
                    id="fhelp"
                    placeholder="Shown under the field on the form"
                    value={draft.helpText}
                    onChange={(e) => setDraft({ ...draft, helpText: e.target.value })}
                  />
                </div>
              </div>
            )}
          </div>
        </form>
      )}
      {error && <p className="mb-3 text-base text-reject">{error}</p>}
      <LedgerTable
        columns={[
          {
            key: 'name',
            header: 'Field',
            render: (field) => <span className="font-mono text-sm text-ink">{field.name}</span>,
          },
          {
            key: 'type',
            header: 'Type',
            render: (field) => (
              <span className="font-mono text-xs text-ink-soft">{field.type}</span>
            ),
          },
          {
            key: 'source',
            header: 'Source',
            render: (field) =>
              field.source === 'looked_up' ? (
                <span className="font-mono text-xs text-ink-soft">
                  looked_up · {field.lookupUrl ?? '—'} ·{' '}
                  {(field.lookupFallback ?? 'treat_as_no_match').replaceAll('_', ' ')}
                </span>
              ) : (
                <span className="font-mono text-xs text-ink-soft">{field.source ?? 'payload'}</span>
              ),
          },
          {
            key: 'portal',
            header: 'Request form',
            render: (field) =>
              field.userSubmittable ? (
                <span className="font-mono text-xs text-ink-soft">
                  {field.inputType ?? `auto:${field.type}`}
                  {field.contexts && field.contexts.length > 0
                    ? ` · ${field.contexts.join(', ')}`
                    : ' · all'}
                </span>
              ) : (
                <span className="text-xs text-ink-soft/60">—</span>
              ),
          },
          {
            key: 'description',
            header: 'Description',
            render: (field) => field.description ?? '—',
          },
          {
            key: 'actions',
            header: '',
            className: 'w-24 text-right',
            render: (field) =>
              can('rule:create') && (
                <Button
                  variant="ghost"
                  className="h-7 text-sm"
                  onClick={() => void remove(field.id)}
                >
                  Remove
                </Button>
              ),
          },
        ]}
        rows={fields}
        rowKey={(field) => field.id}
        loading={loading}
        empty={
          <EmptyState
            headline="No fields defined"
            body="Register the payload fields your rules will reference — amount, department, vendor.country — so builders get dropdowns and numbers compare correctly."
          />
        }
      />
    </>
  );
}
