/**
 * No-login approval landing (CP2). The page an approver lands on after clicking
 * the approve/reject link in an email or WhatsApp message. The signed token in
 * the URL is the only credential — no session, no password. We preview the
 * request (GET), render the full decision context, and let the signer act once
 * (POST). Every non-`valid` state gets its own honest terminal screen.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { Wordmark } from '../components/AppShell';
import { StampChip } from '../components/StampChip';
import { Button, Card, Label, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatINR, timeAgo } from '../lib/format';

type NoLoginAction = 'approve' | 'reject';

interface LandingDetail {
  title: string | null;
  externalRef: string | null;
  payload: Record<string, unknown>;
  createdByName: string | null;
  createdAt: string;
  matchedRule: { name: string; version: number } | null;
  workflowName: string | null;
  chain: string[];
  stepPosition: { index: number; total: number };
  approvals: { approverName: string | null; action: NoLoginAction; actedAt: string }[];
  waitingOn: string[];
  dueAt: string | null;
}

type ApprovalTokenView =
  | {
      state: 'valid';
      tenantId: string;
      stepId: string;
      requestId: string;
      approverName: string | null;
      allowedActions: NoLoginAction[];
      amount: number | null;
      ceiling: number;
      expiresAt: string;
      detail: LandingDetail;
    }
  | { state: 'not_found' }
  | { state: 'expired'; expiresAt: string }
  | { state: 'consumed'; action: NoLoginAction | null; consumedAt: string }
  | { state: 'already_handled'; handledBy: string | null }
  | { state: 'over_ceiling'; amount: number; ceiling: number };

type ApprovalTokenOutcome =
  | { state: 'acted'; action: NoLoginAction; requestId: string; stepId: string }
  | { state: 'not_found' }
  | { state: 'expired' }
  | { state: 'consumed'; action: NoLoginAction | null; consumedAt: string }
  | { state: 'already_handled'; handledBy: string | null }
  | { state: 'over_ceiling'; amount: number; ceiling: number }
  | { state: 'invalid_action'; reason: 'not_allowed' | 'comment_required' }
  | { state: 'forbidden'; message: string };

/* ─── Shell ──────────────────────────────────────────────────────────────── */
function Shell({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="app-bg flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-center border-b border-rule">
        <Wordmark />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-10 sm:py-14">{children}</main>
      <footer className="border-t border-rule px-6 py-4 text-center font-mono text-[11px] text-ink-soft/60">
        Secured by a one-time signed link · ApproveX
      </footer>
    </div>
  );
}

/* A centered terminal message for every state that isn't actionable. */
function Terminal({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ReactNode;
  tone: 'approve' | 'reject' | 'pending' | 'neutral';
  title: string;
  body: React.ReactNode;
}): React.JSX.Element {
  const ring = {
    approve: 'text-approve bg-approve/10',
    reject: 'text-reject bg-reject/10',
    pending: 'text-pending bg-pending/10',
    neutral: 'text-ink-soft bg-ink-soft/10',
  }[tone];
  return (
    <Card className="w-full max-w-md p-8 text-center">
      <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${ring}`}>
        {icon}
      </div>
      <h1 className="mt-5 text-lg font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">{body}</p>
      <Link
        to="/login"
        className="mt-6 inline-flex text-sm font-medium text-brand hover:text-brand-ink"
      >
        Sign in to ApproveX →
      </Link>
    </Card>
  );
}

/* ─── Payload ledger ─────────────────────────────────────────────────────── */
function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function PayloadLedger({ payload }: { payload: Record<string, unknown> }): React.JSX.Element {
  const entries = Object.entries(payload);
  if (entries.length === 0) {
    return <p className="text-sm text-ink-soft">No structured payload on this request.</p>;
  }
  return (
    <dl className="divide-y divide-rule/60 overflow-hidden rounded-[8px] border border-rule">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start justify-between gap-4 bg-surface px-3 py-2">
          <dt className="font-mono text-xs text-ink-soft">{humanizeKey(key)}</dt>
          <dd className="text-right text-sm font-medium text-ink">{renderValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ─── The approver chain, showing settled + waiting steps ────────────────── */
function ApprovalChain({ detail }: { detail: LandingDetail }): React.JSX.Element {
  const { chain, stepPosition, approvals } = detail;
  return (
    <ol className="space-y-2">
      {chain.map((role, i) => {
        const position = i + 1;
        const settled = approvals[i];
        const isCurrent = position === stepPosition.index;
        const done = position < stepPosition.index || Boolean(settled);
        return (
          <li key={`${role}-${i}`} className="flex items-center gap-3">
            <span
              className={
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-[11px] ' +
                (settled?.action === 'reject'
                  ? 'bg-reject/15 text-reject'
                  : done
                    ? 'bg-approve/15 text-approve'
                    : isCurrent
                      ? 'bg-brand-bg text-brand ring-1 ring-brand'
                      : 'bg-ink-soft/10 text-ink-soft')
              }
            >
              {done ? (settled?.action === 'reject' ? '✕' : '✓') : position}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">{role}</p>
              {settled ? (
                <p className="font-mono text-[11px] text-ink-soft">
                  {settled.action === 'reject' ? 'Rejected' : 'Approved'}
                  {settled.approverName ? ` by ${settled.approverName}` : ''} ·{' '}
                  {timeAgo(settled.actedAt)}
                </p>
              ) : isCurrent ? (
                <p className="font-mono text-[11px] text-brand">Waiting on this step — that's you</p>
              ) : (
                <p className="font-mono text-[11px] text-ink-soft/70">Pending</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export function ApprovePage(): React.JSX.Element {
  const { token = '' } = useParams<{ token: string }>();
  const [view, setView] = useState<ApprovalTokenView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState<NoLoginAction | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Extract<ApprovalTokenOutcome, { state: 'acted' }> | null>(
    null,
  );

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      setView(await api<ApprovalTokenView>(`/public/approvals/${encodeURIComponent(token)}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts on this link. Wait a minute and refresh.'
          : 'This link could not be loaded. Check your connection and refresh.',
      );
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: NoLoginAction): Promise<void> => {
    if (action === 'reject' && comment.trim().length === 0) {
      setActError('A short reason is required to reject.');
      return;
    }
    setPending(action);
    setActError(null);
    try {
      const result = await api<ApprovalTokenOutcome>(
        `/public/approvals/${encodeURIComponent(token)}`,
        { method: 'POST', body: { action, comment: comment.trim() || undefined } },
      );
      if (result.state === 'acted') {
        setOutcome(result);
      } else if (result.state === 'invalid_action') {
        setActError(
          result.reason === 'comment_required'
            ? 'A short reason is required to reject.'
            : 'That action is not allowed on this link.',
        );
      } else if (result.state === 'forbidden') {
        setActError(result.message);
      } else {
        // The token was spent/expired/superseded between preview and submit —
        // re-render the fresh terminal state instead of a stale form.
        setView(result as ApprovalTokenView);
      }
    } catch (err) {
      setActError(
        err instanceof ApiError && err.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'Could not record your decision. Please try again.',
      );
    } finally {
      setPending(null);
    }
  };

  /* Terminal: our decision was recorded. */
  if (outcome) {
    const approved = outcome.action === 'approve';
    return (
      <Shell>
        <Terminal
          tone={approved ? 'approve' : 'reject'}
          icon={approved ? <CheckCircle2 size={26} /> : <XCircle size={26} />}
          title={approved ? 'Approved' : 'Rejected'}
          body={
            approved
              ? 'Your approval is recorded and the request has moved to the next step. You can close this page.'
              : 'Your rejection is recorded and the request has been stopped. You can close this page.'
          }
        />
      </Shell>
    );
  }

  /* Loading / load failure. */
  if (loadError) {
    return (
      <Shell>
        <Terminal
          tone="neutral"
          icon={<ShieldAlert size={26} />}
          title="Couldn't open this link"
          body={
            <>
              {loadError}
              <button
                onClick={() => void load()}
                className="ml-1 font-medium text-brand hover:text-brand-ink"
              >
                Retry
              </button>
            </>
          }
        />
      </Shell>
    );
  }
  if (!view) {
    return (
      <Shell>
        <div className="flex items-center gap-2 pt-16 text-ink-soft">
          <Loader2 size={18} className="animate-spin" />
          <span className="font-mono text-sm">Loading request…</span>
        </div>
      </Shell>
    );
  }

  /* Non-actionable terminal states. */
  switch (view.state) {
    case 'not_found':
      return (
        <Shell>
          <Terminal
            tone="neutral"
            icon={<ShieldAlert size={26} />}
            title="Link not recognized"
            body="This approval link is invalid or has been revoked. If you still need to act, sign in to your inbox."
          />
        </Shell>
      );
    case 'expired':
      return (
        <Shell>
          <Terminal
            tone="pending"
            icon={<Clock size={26} />}
            title="This link has expired"
            body={`For security, approval links expire. This one lapsed ${timeAgo(view.expiresAt)}. Sign in to act on the request.`}
          />
        </Shell>
      );
    case 'consumed':
      return (
        <Shell>
          <Terminal
            tone={view.action === 'reject' ? 'reject' : 'approve'}
            icon={view.action === 'reject' ? <XCircle size={26} /> : <CheckCircle2 size={26} />}
            title="Already decided"
            body={`This link was already ${view.action === 'reject' ? 'used to reject' : 'used to approve'} ${timeAgo(view.consumedAt)}. No further action is needed.`}
          />
        </Shell>
      );
    case 'already_handled':
      return (
        <Shell>
          <Terminal
            tone="neutral"
            icon={<CheckCircle2 size={26} />}
            title="Handled by someone else"
            body={`This step was already actioned${view.handledBy ? ` by ${view.handledBy}` : ''}. Nothing is waiting on you.`}
          />
        </Shell>
      );
    case 'over_ceiling':
      return (
        <Shell>
          <Terminal
            tone="pending"
            icon={<ShieldAlert size={26} />}
            title="Approval needs a signed-in review"
            body={`This request (${formatINR(view.amount)}) is above the ${formatINR(view.ceiling)} limit for one-click approval. Please sign in to review and act.`}
          />
        </Shell>
      );
  }

  /* state === 'valid' — the actionable landing. */
  const { detail, amount, allowedActions } = view;
  const canApprove = allowedActions.includes('approve');
  const canReject = allowedActions.includes('reject');
  const acting = pending !== null;

  return (
    <Shell>
      <Card className="w-full max-w-lg overflow-hidden p-0">
        {/* header */}
        <div className="border-b border-rule bg-surface/60 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs uppercase tracking-[0.12em] text-ink-soft/70">
              Approval requested
            </span>
            <StampChip
              label={`Step ${detail.stepPosition.index} of ${detail.stepPosition.total}`}
              tone="brand"
            />
          </div>
          <h1 className="mt-2 text-lg font-semibold text-ink">
            {detail.title ?? 'Approval request'}
          </h1>
          <p className="mt-1 font-mono text-xs text-ink-soft">
            {detail.externalRef ? `${detail.externalRef} · ` : ''}
            {detail.createdByName ? `Raised by ${detail.createdByName} · ` : ''}
            {timeAgo(detail.createdAt)}
          </p>
          {view.approverName && (
            <p className="mt-3 text-sm text-ink">
              Hi {view.approverName}, your approval is needed.
            </p>
          )}
        </div>

        <div className="space-y-6 px-6 py-5">
          {/* amount headline */}
          {amount !== null && (
            <div className="rounded-[10px] border border-rule bg-brand-bg/40 px-4 py-3">
              <p className="font-mono text-[11px] uppercase tracking-wide text-ink-soft">Amount</p>
              <p className="text-2xl font-bold tracking-tight text-ink">{formatINR(amount)}</p>
            </div>
          )}

          {/* rule + workflow context */}
          {(detail.matchedRule || detail.workflowName) && (
            <div className="flex flex-wrap gap-2 font-mono text-[11px] text-ink-soft">
              {detail.matchedRule && (
                <span className="rounded-[6px] border border-rule px-2 py-1">
                  Matched: {detail.matchedRule.name} · v{detail.matchedRule.version}
                </span>
              )}
              {detail.workflowName && (
                <span className="rounded-[6px] border border-rule px-2 py-1">
                  Flow: {detail.workflowName}
                </span>
              )}
            </div>
          )}

          {/* payload */}
          <section>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
              Request details
            </p>
            <PayloadLedger payload={detail.payload} />
          </section>

          {/* approver chain */}
          {detail.chain.length > 0 && (
            <section>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                Approval chain
              </p>
              <ApprovalChain detail={detail} />
            </section>
          )}

          {detail.dueAt && (
            <p className="font-mono text-[11px] text-ink-soft">
              Due {formatDateTime(detail.dueAt)}
            </p>
          )}

          {/* action */}
          <section className="border-t border-rule pt-5">
            <Label htmlFor="approve-comment">
              Comment {canReject && <span className="text-ink-soft">(required to reject)</span>}
            </Label>
            <Textarea
              id="approve-comment"
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Add a note for the audit trail…"
              className="mt-1"
              disabled={acting}
            />
            {actError && <p className="mt-2 text-sm text-reject">{actError}</p>}
            <div className="mt-4 flex gap-3">
              {canApprove && (
                <Button
                  variant="primary"
                  className="h-10 flex-1 justify-center text-md"
                  disabled={acting}
                  onClick={() => void act('approve')}
                >
                  {pending === 'approve' ? 'Approving…' : 'Approve'}
                </Button>
              )}
              {canReject && (
                <Button
                  variant="danger"
                  className="h-10 flex-1 justify-center text-md"
                  disabled={acting}
                  onClick={() => void act('reject')}
                >
                  {pending === 'reject' ? 'Rejecting…' : 'Reject'}
                </Button>
              )}
            </div>
            <p className="mt-3 text-center font-mono text-[11px] text-ink-soft/70">
              This one-time link expires {formatDateTime(view.expiresAt)}
            </p>
          </section>
        </div>
      </Card>
    </Shell>
  );
}
