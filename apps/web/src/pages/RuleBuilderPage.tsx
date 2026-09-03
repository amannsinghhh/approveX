/**
 * Rule Builder (UI spec §5.2, restructure §3.3): three-pane workbench — rules
 * rail left (260), builder fluid center, live pane right (360) with JSON and
 * Test tabs. The Test tab runs the SAME evaluator the API uses — imported
 * from shared/ — against the unsaved draft AST.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Plus } from 'lucide-react';
import type { ConditionNode, FieldSchema } from '../../../../shared/src/index';
import { evaluateCondition, validateConditionAst } from '../../../../shared/src/index';
import { PageHeader } from '../components/AppShell';
import { ConceptStrip } from '../components/ConceptStrip';
import { ConditionGroup, emptyGroup } from '../components/condition-builder';
import { FieldHelp } from '../components/FieldHelp';
import { IssueList } from '../components/IssueList';
import { ThreePane } from '../components/layout';
import { PlainLanguageToggle } from '../components/PlainLanguageToggle';
import { StampChip } from '../components/StampChip';
import { TraceReceipt } from '../components/TraceReceipt';
import { Button, Card, Input, Label, Tabs, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { humanizeConditionIssue } from '../lib/issue-language';
import type { FieldDefinition, ManagedList, Rule } from '../lib/types';

/**
 * Numbered step marker — turns the builder from a wall of controls into a
 * visible 1-2-3 path: describe → build → check.
 */
function StepHeading({
  n,
  title,
  hint,
  className,
}: {
  n: number;
  title: string;
  hint?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn('flex items-baseline gap-2', className)}>
      <span className="flex h-5 w-5 shrink-0 translate-y-0.5 items-center justify-center rounded-full bg-[image:var(--brand-grad)] font-mono text-[11px] font-bold text-white shadow-[var(--glow-brand)]">
        {n}
      </span>
      <h2 className="text-md font-bold tracking-tight text-ink">{title}</h2>
      {hint && <span className="hidden text-sm text-ink-soft md:inline">— {hint}</span>}
    </div>
  );
}

export function RuleBuilderPage(): React.JSX.Element {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { can } = useAuth();

  const [rule, setRule] = useState<Rule | null>(null);
  const [allRules, setAllRules] = useState<Rule[]>([]);
  const [name, setName] = useState('');
  const [context, setContext] = useState('PAYMENT_APPROVAL');
  const [priority, setPriority] = useState(100);
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');
  const [ast, setAst] = useState<ConditionNode>(emptyGroup());
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [listNames, setListNames] = useState<string[]>([]);
  const [tab, setTab] = useState<'json' | 'test'>('json');
  const [testPayload, setTestPayload] = useState('{\n  "amount": 200000\n}');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmPublish, setConfirmPublish] = useState(false);
  /** Scoring rules have no visual editor yet — this page must not overwrite one. */
  const [isScoring, setIsScoring] = useState(false);

  useEffect(() => {
    void api<{ items: FieldDefinition[] }>('/fields').then((res) => setFields(res.items));
    void api<{ items: ManagedList[] }>('/managed-lists').then((res) =>
      setListNames(res.items.map((list) => list.name)),
    );
    void api<{ items: Rule[] }>('/rules').then((res) => setAllRules(res.items));
    if (!isNew && id) {
      void api<Rule>(`/rules/${id}`).then((loaded) => {
        setRule(loaded);
        setName(loaded.name);
        setContext(loaded.context);
        const head = loaded.versions?.[0] ?? loaded.latestVersion;
        if (head) {
          setIsScoring(head.ruleType === 'scoring');
          if (head.conditionAst) setAst(head.conditionAst);
          setPriority(head.priority);
          setEffectiveFrom(head.effectiveFrom?.slice(0, 10) ?? '');
          setEffectiveTo(head.effectiveTo?.slice(0, 10) ?? '');
        }
      });
    }
  }, [id, isNew]);

  const fieldSchema = useMemo<FieldSchema>(
    () => Object.fromEntries(fields.map((field) => [field.name, field.type])),
    [fields],
  );

  const validation = useMemo(() => validateConditionAst(ast, fieldSchema), [ast, fieldSchema]);

  const testResult = useMemo(() => {
    if (tab !== 'test') return null;
    try {
      const data: unknown = JSON.parse(testPayload);
      return { evaluation: evaluateCondition(ast, data, { fieldSchema }), parseError: null };
    } catch {
      return { evaluation: null, parseError: 'Payload is not valid JSON.' };
    }
  }, [tab, testPayload, ast, fieldSchema]);

  const versionBody = {
    conditionAst: ast,
    priority,
    ...(effectiveFrom ? { effectiveFrom: new Date(effectiveFrom).toISOString() } : {}),
    ...(effectiveTo ? { effectiveTo: new Date(effectiveTo).toISOString() } : {}),
  };

  const saveDraft = async (): Promise<string | null> => {
    setBusy(true);
    setMessage(null);
    try {
      if (isNew) {
        const created = await api<Rule>('/rules', {
          method: 'POST',
          body: { name, context, ...versionBody },
        });
        setMessage({ tone: 'ok', text: 'Draft saved' });
        navigate(`/rules/${created.id}`, { replace: true });
        return created.id;
      }
      if (rule && name !== rule.name) {
        await api(`/rules/${id}`, { method: 'PATCH', body: { name } });
      }
      await api(`/rules/${id}/draft`, { method: 'PUT', body: versionBody });
      setMessage({ tone: 'ok', text: 'Draft saved' });
      return id ?? null;
    } catch (err) {
      setMessage({
        tone: 'err',
        text: err instanceof ApiError ? err.message : 'Could not save the draft.',
      });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const publish = async (): Promise<void> => {
    setConfirmPublish(false);
    const ruleId = await saveDraft();
    if (!ruleId) return;
    setBusy(true);
    try {
      const published = await api<{ version: number }>(`/rules/${ruleId}/publish`, {
        method: 'POST',
      });
      setMessage({
        tone: 'ok',
        text: `Rule published — v${published.version} now matches new evaluations`,
      });
      const reloaded = await api<Rule>(`/rules/${ruleId}`);
      setRule(reloaded);
    } catch (err) {
      setMessage({
        tone: 'err',
        text: err instanceof ApiError ? err.message : 'Could not publish.',
      });
    } finally {
      setBusy(false);
    }
  };

  const status = rule?.status ?? 'draft';
  const nextVersion = (rule?.currentVersion ?? 0) + 1;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Input
              aria-label="Rule name"
              className="h-10 w-96 text-lg font-bold"
              placeholder="Payments above ₹5,00,000"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <StampChip label={status} />
          </span>
        }
        actions={
          <>
            {can('rule:create') && (
              <Button onClick={() => void saveDraft()} disabled={busy || !name || isScoring}>
                Save draft
              </Button>
            )}
            {can('rule:publish') && (
              <Button
                variant="primary"
                disabled={busy || !name || !validation.valid || isScoring}
                onClick={() => setConfirmPublish(true)}
              >
                Publish rule
              </Button>
            )}
          </>
        }
      />

      <ConceptStrip id="rule-builder" title="What is a rule?">
        A rule is a condition (built below) that ApproveX checks when your system calls{' '}
        <code className="font-mono">POST /evaluate</code>. When every part matches, the rule fires
        and can start an approval workflow. Build the condition, test it on the right, then publish
        — published versions are immutable, so editing creates a new version.
      </ConceptStrip>

      {isScoring && (
        <Card className="mb-4 border-brand bg-brand-bg p-3">
          <p className="text-base text-ink">
            This is a <strong>scoring rule</strong> — a weighted score measured against a threshold.
            It has no visual editor yet, so editing is disabled here to protect it. Manage it
            through the API for now.
          </p>
        </Card>
      )}

      {confirmPublish && (
        <Card className="mb-4 flex items-center gap-3 border-brand bg-brand-bg p-3">
          <p className="flex-1 text-base text-ink">
            v{nextVersion} will apply to new evaluations.
            {rule &&
              rule.currentVersion > 0 &&
              ` Anything running stays on v${rule.currentVersion}.`}{' '}
            Published versions cannot be edited.
          </p>
          <Button onClick={() => setConfirmPublish(false)}>Keep editing</Button>
          <Button variant="primary" onClick={() => void publish()}>
            Publish v{nextVersion}
          </Button>
        </Card>
      )}

      {message && (
        <div
          role="status"
          className={cn(
            'animate-pop mb-3 flex items-center gap-2 rounded-[8px] border px-3 py-2 text-base font-medium elev-sm',
            message.tone === 'ok'
              ? 'border-approve/40 bg-approve-bg text-approve'
              : 'border-reject/40 bg-reject-bg text-reject',
          )}
        >
          {message.tone === 'ok' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
          {message.text}
        </div>
      )}

      {(() => {
        const rulesRail = (
          <div className="flex flex-col divide-y divide-rule">
            <button
              type="button"
              onClick={() => navigate('/rules/new')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-left text-sm font-medium transition-colors duration-100',
                isNew
                  ? 'bg-brand-bg/50 text-brand shadow-[inset_2px_0_0_var(--brand)]'
                  : 'text-brand hover:bg-paper/60',
              )}
            >
              <Plus size={14} /> New rule
            </button>
            {allRules.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(`/rules/${item.id}`)}
                className={cn(
                  'px-3 py-2 text-left transition-colors duration-100',
                  item.id === id
                    ? 'bg-brand-bg/50 shadow-[inset_2px_0_0_var(--brand)]'
                    : 'hover:bg-paper/60',
                )}
              >
                <p className="truncate text-sm font-medium text-ink">{item.name}</p>
                <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-ink-soft">
                  v{item.currentVersion}
                  <StampChip label={item.status} />
                </p>
              </button>
            ))}
          </div>
        );

        const builderPane = (
          <div className="flex flex-col divide-y divide-rule">
            <section className="px-4 py-3">
              <StepHeading
                n={1}
                title="Describe the rule"
                hint="where it applies, and who wins a clash"
                className="mb-3"
              />
              <DescribeFields />
            </section>
            {!isScoring && (
              <section className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <StepHeading
                    n={2}
                    title="Build the condition"
                    hint="reads top-to-bottom, like a sentence"
                  />
                  {validation.valid ? (
                    <span className="animate-pop flex items-center gap-1 rounded-full bg-approve-bg px-2.5 py-0.5 text-xs font-semibold text-approve">
                      <CheckCircle2 size={12} /> Condition is valid
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 rounded-full bg-pending-bg px-2.5 py-0.5 text-xs font-semibold text-pending">
                      <AlertTriangle size={12} />
                      {validation.issues.length === 1
                        ? '1 thing to fix'
                        : `${validation.issues.length} things to fix`}
                    </span>
                  )}
                </div>
                <ConditionGroup node={ast} fields={fields} lists={listNames} onChange={setAst} />
                {!validation.valid && (
                  <IssueList
                    className="mt-3"
                    issues={validation.issues.map(humanizeConditionIssue)}
                    showPaths={can('rule:publish')}
                  />
                )}
              </section>
            )}
          </div>
        );

        const livePane = (
          <div className="px-3 py-3">
            <StepHeading
              n={3}
              title="Check your work"
              hint="read it back, then dry-run a payload"
              className="mb-2"
            />
            <Tabs
              value={tab}
              tabs={[
                { value: 'json', label: 'Read it back' },
                { value: 'test', label: 'Test run' },
              ]}
              onChange={setTab}
            />
            {tab === 'json' && <PlainLanguageToggle node={ast} className="mt-3" />}
            {tab === 'test' && (
              <div className="mt-3 flex flex-col gap-3">
                <div>
                  <Label htmlFor="test-payload">Sample payload (JSON)</Label>
                  <Textarea
                    id="test-payload"
                    aria-label="Test payload"
                    rows={6}
                    className="font-mono text-sm"
                    value={testPayload}
                    onChange={(e) => setTestPayload(e.target.value)}
                  />
                  <FieldHelp>
                    Paste what your system would send to POST /evaluate — the verdict updates live
                    as you type. Nothing is saved or created.
                  </FieldHelp>
                </div>
                {testResult?.parseError && (
                  <p className="flex items-center gap-1.5 text-sm text-reject">
                    <AlertTriangle size={13} /> {testResult.parseError}
                  </p>
                )}
                {testResult?.evaluation && (
                  <TraceReceipt
                    matched={testResult.evaluation.matched}
                    matchedLabel={name || 'this draft'}
                    trace={testResult.evaluation.trace}
                  />
                )}
              </div>
            )}
          </div>
        );

        return (
          <ThreePane
            className="h-[calc(100dvh-170px)]"
            leftWidth={260}
            rightWidth={360}
            left={rulesRail}
            center={builderPane}
            right={livePane}
          />
        );
      })()}
    </>
  );

  /** Step-1 metadata fields, extracted so the pane composition stays readable. */
  function DescribeFields(): React.JSX.Element {
    return (
      <div className="flex flex-wrap items-start gap-4">
          <div>
            <Label htmlFor="context">Context</Label>
            <Input
              id="context"
              className="w-56 font-mono text-sm"
              value={context}
              disabled={!isNew}
              onChange={(e) => setContext(e.target.value.toUpperCase())}
            />
            <FieldHelp>Your system sends this with POST /evaluate</FieldHelp>
          </div>
          <div>
            <Label htmlFor="priority">Priority</Label>
            <Input
              id="priority"
              type="number"
              min={0}
              className="w-24 font-mono text-sm"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
            <FieldHelp>Lower number wins when rules clash</FieldHelp>
          </div>
          <div>
            <Label htmlFor="from">Effective from</Label>
            <Input
              id="from"
              type="date"
              className="w-40 font-mono text-sm"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
            <FieldHelp>Optional — starts matching on this date</FieldHelp>
          </div>
          <div>
            <Label htmlFor="to">Effective to</Label>
            <Input
              id="to"
              type="date"
              className="w-40 font-mono text-sm"
              value={effectiveTo}
              onChange={(e) => setEffectiveTo(e.target.value)}
            />
            <FieldHelp>Optional — stops matching after this date</FieldHelp>
          </div>
      </div>
    );
  }
}
