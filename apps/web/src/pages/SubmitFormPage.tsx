/**
 * Portal form (/submit/:context): the generated form for one context. Fields
 * come from the registry (ordered, typed); values are collected keyed by field
 * name (a dot-path) and POSTed. Rule-matching on the backend picks the flow —
 * the submitter never names a workflow. On success we show what became of it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../components/AppShell';
import { StampChip } from '../components/StampChip';
import { Button, Card, Input, Label, Select, Textarea } from '../components/ui';
import { ApiError, api } from '../lib/api';
import type { PortalForm, PortalFormField, PortalSubmitResult } from '../lib/types';

/** A single value in the form draft — the shapes an input can produce. */
type FieldValue = string | number | boolean | undefined;

/** Strips the "currency:" tag off a unit to show just the code (e.g. INR). */
function currencyCode(unit: string | null): string | null {
  if (!unit?.startsWith('currency:')) return null;
  return unit.slice('currency:'.length) || null;
}

function FieldControl({
  field,
  value,
  onChange,
}: {
  field: PortalFormField;
  value: FieldValue;
  onChange: (value: FieldValue) => void;
}): React.JSX.Element {
  const id = `f-${field.name}`;
  const code = currencyCode(field.unit);

  switch (field.inputType) {
    case 'select':
      return (
        <Select
          id={id}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        >
          <option value="">Select…</option>
          {field.enumValues.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      );
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          Yes
        </label>
      );
    case 'textarea':
      return (
        <Textarea
          id={id}
          rows={3}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'date':
      return (
        <Input
          id={id}
          type="date"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    case 'number':
    case 'currency':
      return (
        <div className="flex items-center gap-2">
          {code && <span className="font-mono text-sm text-ink-soft">{code}</span>}
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            step={field.precision != null ? Math.pow(10, -field.precision).toString() : 'any'}
            value={value === undefined ? '' : String(value)}
            onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </div>
      );
    case 'file':
      // No upload endpoint in this slice — accept a reference (link / ticket id).
      return (
        <Input
          id={id}
          placeholder="Paste a link or reference"
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
    default:
      return (
        <Input
          id={id}
          value={value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
      );
  }
}

export function SubmitFormPage(): React.JSX.Element {
  const { context = '' } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<PortalForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState<Record<string, FieldValue>>({});
  const [title, setTitle] = useState('');
  const [externalRef, setExternalRef] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<PortalSubmitResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await api<PortalForm>(`/portal/contexts/${encodeURIComponent(context)}`);
        if (!cancelled) {
          setForm(res);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError && err.status === 404
              ? `No submission form is configured for "${context}".`
              : "Couldn't load this form. Check your connection and retry.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [context]);

  const setField = useCallback((name: string, value: FieldValue) => {
    setDraft((prev) => ({ ...prev, [name]: value }));
  }, []);

  const submit = async (): Promise<void> => {
    if (!form) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      // Drop keys the user never touched — send only the values they entered.
      const data: Record<string, unknown> = {};
      for (const field of form.fields) {
        const value = draft[field.name];
        if (value !== undefined && value !== '') data[field.name] = value;
      }
      const res = await api<PortalSubmitResult>(
        `/portal/contexts/${encodeURIComponent(context)}/requests`,
        {
          method: 'POST',
          body: {
            data,
            ...(title.trim() ? { title: title.trim() } : {}),
            ...(externalRef.trim() ? { externalRef: externalRef.trim() } : {}),
          },
        },
      );
      setResult(res);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError && typeof err.body === 'object' && err.body !== null
          ? String((err.body as { message?: unknown }).message ?? 'Submission failed.')
          : 'Submission failed. Check your entries and retry.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <>
        <PageHeader title="New request" />
        <p className="text-sm text-ink-soft">Loading form…</p>
      </>
    );
  }

  if (loadError || !form) {
    return (
      <>
        <PageHeader title="New request" />
        <Card className="px-4 py-4">
          <p className="text-sm text-reject">{loadError ?? 'Form unavailable.'}</p>
          <Link to="/submit" className="mt-3 inline-block">
            <Button variant="secondary">
              <ArrowLeft size={15} /> Back to submission types
            </Button>
          </Link>
        </Card>
      </>
    );
  }

  // Success screen — what became of the submission, with next steps.
  if (result) {
    return (
      <>
        <PageHeader title="Request submitted" />
        <Card className="px-5 py-5">
          <div className="flex items-center gap-2 text-approve">
            <CheckCircle2 size={20} />
            <p className="text-md font-bold text-ink">Your request was submitted</p>
          </div>
          <dl className="mt-4 grid gap-2 text-sm">
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-ink-soft">Reference</dt>
              <dd className="font-mono text-ink">{result.requestId ?? '—'}</dd>
            </div>
            <div className="flex items-center gap-2">
              <dt className="w-28 shrink-0 text-ink-soft">Status</dt>
              <dd>{result.status ? <StampChip label={result.status} /> : '—'}</dd>
            </div>
          </dl>
          <div className="mt-5 flex gap-2">
            <Button variant="primary" onClick={() => navigate('/my-requests')}>
              Track my requests
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setResult(null);
                setDraft({});
                setTitle('');
                setExternalRef('');
              }}
            >
              Submit another
            </Button>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New request"
        subtitle={<span className="font-mono">{form.context}</span>}
        actions={
          <Link to="/submit">
            <Button variant="ghost">
              <ArrowLeft size={15} /> Back
            </Button>
          </Link>
        }
      />

      <Card className="px-5 py-5">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {form.fields.map((field) => (
            <div key={field.name}>
              <Label htmlFor={`f-${field.name}`}>
                {field.label}
                {field.required && <span className="ml-1 text-reject">*</span>}
              </Label>
              <FieldControl
                field={field}
                value={draft[field.name]}
                onChange={(value) => setField(field.name, value)}
              />
              {field.helpText && <p className="mt-1 text-xs text-ink-soft">{field.helpText}</p>}
            </div>
          ))}

          <div className="border-t border-rule pt-4">
            <p className="mb-3 text-xs font-medium uppercase tracking-[0.06em] text-ink-soft">
              Optional
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="f-title">Title</Label>
                <Input
                  id="f-title"
                  placeholder="A short label for this request"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="f-externalRef">Reference</Label>
                <Input
                  id="f-externalRef"
                  placeholder="e.g. a ticket id"
                  value={externalRef}
                  onChange={(e) => setExternalRef(e.target.value)}
                />
              </div>
            </div>
          </div>

          {submitError && <p className="text-sm text-reject">{submitError}</p>}

          <div className="flex items-center gap-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
