/**
 * Testing Sandbox (UI spec §5.4): payload editor left, receipt right.
 * Runs POST /evaluate mode=dry_run — the server-side path, zero side effects.
 */
import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/AppShell';
import { StampChip } from '../components/StampChip';
import { TraceReceipt } from '../components/TraceReceipt';
import { Button, Card, Input, Label, Segmented, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import type { DryRunResult, FieldDefinition } from '../lib/types';

export function SandboxPage(): React.JSX.Element {
  const [context, setContext] = useState('PAYMENT_APPROVAL');
  const [mode, setMode] = useState<'json' | 'form'>('json');
  const [payload, setPayload] = useState('{\n  "amount": 840000,\n  "country": "India"\n}');
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState(true);

  useEffect(() => {
    void api<{ items: FieldDefinition[] }>('/fields').then((res) => setFields(res.items));
  }, []);

  const data = useMemo((): unknown | Error => {
    if (mode === 'form') {
      const out: Record<string, unknown> = {};
      for (const field of fields) {
        const raw = formValues[field.name];
        if (raw === undefined || raw === '') continue;
        out[field.name] =
          field.type === 'number' && !Number.isNaN(Number(raw))
            ? Number(raw)
            : field.type === 'boolean'
              ? raw === 'true'
              : raw;
      }
      return out;
    }
    try {
      return JSON.parse(payload);
    } catch {
      return new Error('Payload is not valid JSON.');
    }
  }, [mode, payload, formValues, fields]);

  const run = async (): Promise<void> => {
    if (data instanceof Error) {
      setError(data.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<DryRunResult>('/evaluate', {
          method: 'POST',
          body: { context, data, mode: 'dry_run', includeTraces: true },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the API. Retry.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Sandbox" />
      {banner && (
        <Card className="mb-4 flex items-center gap-3 p-3">
          <StampChip label="DRY RUN" tone="brand" />
          <p className="flex-1 text-base text-ink-soft">
            Nothing is created here — no requests, no workflows, no webhooks.
          </p>
          <Button variant="ghost" className="h-7 text-sm" onClick={() => setBanner(false)}>
            Dismiss
          </Button>
        </Card>
      )}

      <div className="flex gap-5">
        <section className="min-w-0 flex-[2]">
          <div className="mb-3 flex items-end gap-3">
            <div>
              <Label htmlFor="ctx">Context</Label>
              <Input
                id="ctx"
                className="w-56 font-mono text-sm"
                value={context}
                onChange={(e) => setContext(e.target.value.toUpperCase())}
              />
            </div>
            <Segmented
              value={mode}
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'form', label: 'Form' },
              ]}
              onChange={setMode}
            />
            <span className="flex-1" />
            <Button variant="primary" onClick={() => void run()} disabled={busy}>
              {busy ? 'Running…' : 'Run dry-run'}
            </Button>
          </div>

          {mode === 'json' ? (
            <Textarea
              aria-label="Payload"
              rows={12}
              className="font-mono text-sm"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
            />
          ) : (
            <Card className="flex flex-col gap-3 p-4">
              {fields.length === 0 && (
                <p className="text-base text-ink-soft">
                  No fields registered yet — define them under Fields to get a generated form.
                </p>
              )}
              {fields.map((field) => (
                <div key={field.id} className="flex items-center gap-3">
                  <span className="w-48 truncate font-mono text-sm text-ink">{field.name}</span>
                  <span className="w-10 font-mono text-xs text-ink-soft">
                    {field.type.slice(0, 3)}
                  </span>
                  <Input
                    aria-label={field.name}
                    className="flex-1 font-mono text-sm"
                    value={formValues[field.name] ?? ''}
                    onChange={(e) => setFormValues({ ...formValues, [field.name]: e.target.value })}
                  />
                </div>
              ))}
            </Card>
          )}
          {error && <p className="mt-2 text-base text-reject">{error}</p>}
        </section>

        <section className="min-w-0 flex-[3]">
          {!result && (
            <Card className="flex h-48 items-center justify-center">
              <p className="text-base text-ink-soft">Run a payload to see the receipt.</p>
            </Card>
          )}
          {result && (
            <div className="flex flex-col gap-4">
              <TraceReceipt
                matched={result.matched}
                matchedLabel={
                  result.matched
                    ? `${result.matchedRuleName} (v${result.matchedRuleVersion})   priority ${result.priorityUsed}`
                    : `no rule in ${result.context} matched — policy: ${result.noMatchPolicy.replace(/_/g, ' ')}`
                }
                trace={result.evaluationTrace?.nodes ?? []}
                scoreBreakdown={result.evaluationTrace?.scoreBreakdown}
                footer={
                  result.matched ? 'WOULD START  workflow binding arrives in Phase 4' : undefined
                }
              />
              {result.matchesConsidered.length > 0 && (
                <Card className="p-4">
                  <h3 className="mb-2 text-sm font-medium text-ink-soft">
                    Rules considered ({result.matchesConsidered.length}) — resolution order
                  </h3>
                  <div className="flex flex-col gap-1.5">
                    {result.matchesConsidered.map((entry) => (
                      <div key={entry.ruleId} className="flex items-center gap-3 font-mono text-sm">
                        <StampChip
                          label={entry.matched ? 'match' : 'no match'}
                          tone={entry.matched ? 'approve' : 'neutral'}
                        />
                        <span className="text-ink">
                          {entry.ruleName} (v{entry.version})
                        </span>
                        <span className="text-ink-soft">
                          priority {entry.priority} · {entry.conditionCount} conditions
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
