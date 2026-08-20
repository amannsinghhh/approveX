/**
 * Request detail (UI spec §5.1 drawer): header with stamp, payload ledger,
 * "Why am I seeing this?", timeline, and a sticky action bar. Shared by the
 * Inbox and the Requests explorer.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import type { RequestDetailData } from '../lib/types';
import { KeyValueList } from './KeyValueList';
import { MonoId } from './MonoId';
import { StampChip } from './StampChip';
import { Button, Textarea } from './ui';

const ACTION_LABEL: Record<string, string> = {
  approve: 'approved',
  reject: 'rejected',
  delegate: 'delegated',
  comment: 'commented',
};

function Timeline({ detail }: { detail: RequestDetailData }): React.JSX.Element {
  const events = useMemo(() => {
    const rows: {
      at: string;
      actor: string;
      text: string;
      comment?: string | null;
      stamp?: string;
      note?: string;
    }[] = [];
    rows.push({
      at: detail.createdAt,
      actor: detail.createdBy?.name ?? 'unknown',
      text: 'submitted the request',
      stamp: 'pending',
    });
    for (const step of detail.steps) {
      for (const action of step.actions) {
        rows.push({
          at: action.actedAt,
          actor: action.actorName ?? 'unknown',
          text: `${ACTION_LABEL[action.action]} ${step.nodeId}${
            action.action === 'delegate' && action.targetName ? ` to ${action.targetName}` : ''
          }`,
          comment: action.comment,
          stamp:
            action.action === 'approve'
              ? 'approved'
              : action.action === 'reject'
                ? 'rejected'
                : undefined,
          note: action.onBehalfOfName
            ? `acting for ${action.onBehalfOfName} (out-of-office delegation)`
            : undefined,
        });
      }
      if (step.escalatedToRoleId) {
        rows.push({
          at: step.createdAt,
          actor: 'system',
          text: `escalated ${step.nodeId}`,
          note: 'no eligible approver in the original role',
        });
      }
    }
    if (detail.completedAt) {
      rows.push({
        at: detail.completedAt,
        actor: 'system',
        text: `request ${detail.status}`,
        stamp: detail.status,
      });
    }
    return rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [detail]);

  return (
    <div className="rounded-[10px] border border-rule bg-surface">
      <p className="border-b border-rule px-3 py-1.5 text-sm font-medium text-ink-soft">Timeline</p>
      {events.map((event, index) => (
        <div
          key={index}
          className="animate-line-in border-b border-rule px-3 py-2 last:border-b-0"
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <div className="flex items-baseline gap-3">
            <span className="w-32 shrink-0 font-mono text-xs text-ink-soft">
              {formatDateTime(event.at)}
            </span>
            <span className="text-sm font-medium text-ink">{event.actor}</span>
            <span className="text-sm text-ink-soft">{event.text}</span>
            <span className="flex-1" />
            {event.stamp && <StampChip label={event.stamp} />}
          </div>
          {event.comment && <p className="mt-1 pl-[8.75rem] text-sm text-ink">“{event.comment}”</p>}
          {event.note && <p className="mt-0.5 pl-[8.75rem] text-xs text-ink-soft">{event.note}</p>}
        </div>
      ))}
    </div>
  );
}

export function RequestDetail({
  requestId,
  onChanged,
  onDetail,
  focusReject = false,
  hideWhy = false,
}: {
  requestId: string;
  /** Called after an action mutates the request (approve/reject/...). */
  onChanged?: () => void;
  /** Fires with each loaded detail (and null on reset) so a host screen can render a context rail. */
  onDetail?: (detail: RequestDetailData | null) => void;
  /** Keyboard "R" pre-opens the rejection comment. */
  focusReject?: boolean;
  /** Hide the inline "Why am I seeing this?" block (the Inbox shows it in its rail instead). */
  hideWhy?: boolean;
}): React.JSX.Element {
  const { me } = useAuth();
  const [detail, setDetail] = useState<RequestDetailData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [delegating, setDelegating] = useState(false);
  const [delegateTo, setDelegateTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [justStamped, setJustStamped] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<RequestDetailData>(`/requests/${requestId}`);
      setDetail(data);
      onDetail?.(data);
      setError(null);
    } catch {
      setError("Couldn't load the request. Retry.");
    }
  }, [requestId, onDetail]);

  useEffect(() => {
    setDetail(null);
    onDetail?.(null);
    setRejecting(focusReject);
    setRejectComment('');
    setDelegating(false);
    void load();
  }, [load, focusReject, onDetail]);

  const myStep = useMemo(() => {
    if (!detail || !me) return null;
    const eligible = detail.pendingApprovers.find((approver) =>
      approver.eligibleUsers.some((user) => user.id === me.id),
    );
    if (eligible) return eligible;
    // Delegates (ad-hoc / OOO) aren't in eligibleUsers; offer the first
    // pending step and let the API be the judge.
    if (detail.createdById !== me.id && detail.pendingApprovers.length > 0) {
      return detail.pendingApprovers[0];
    }
    return null;
  }, [detail, me]);

  const act = async (
    action: 'approve' | 'reject' | 'delegate',
    body: Record<string, unknown> = {},
  ): Promise<void> => {
    if (!myStep) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/steps/${myStep.stepId}/${action}`, { method: 'POST', body });
      setJustStamped(true);
      setRejecting(false);
      setDelegating(false);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The action failed. Retry.');
    } finally {
      setBusy(false);
    }
  };

  if (!detail) {
    return (
      <div className="flex flex-col gap-3 p-4">
        {error ? (
          <p className="text-base text-reject">{error}</p>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="shimmer h-16 rounded-[10px] bg-rule/40"
              style={{ animationDelay: `${i * 100}ms` }}
            />
          ))
        )}
      </div>
    );
  }

  const why = detail.matchedRule
    ? `Matched rule ${detail.matchedRule.name} (v${detail.matchedRule.version}) → workflow ` +
      `${detail.workflowVersion.workflowName ?? 'unknown'} (v${detail.workflowVersion.version}).`
    : `Created directly against workflow ${detail.workflowVersion.workflowName ?? 'unknown'} ` +
      `(v${detail.workflowVersion.version}).`;

  return (
    <div className="animate-fade flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {/* header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">
              {detail.title ?? detail.context ?? 'Request'}
            </h2>
            <p className="mt-0.5 flex items-center gap-2 font-mono text-sm text-ink-soft">
              <MonoId value={detail.id} />
              {detail.externalRef && <span>· {detail.externalRef}</span>}
              {detail.context && <span>· {detail.context}</span>}
            </p>
          </div>
          <StampChip label={detail.status} thump={justStamped} className="scale-110" />
        </div>

        <div className="flex flex-col gap-4">
          <KeyValueList data={detail.payload} />

          {!hideWhy && (
            <div className="rounded-[10px] border border-rule bg-surface px-3 py-2">
              <p className="text-sm font-medium text-ink-soft">Why am I seeing this?</p>
              <p className="mt-0.5 text-sm text-ink">
                {why}
                {detail.pendingApprovers[0] &&
                  ` Waiting on ${detail.pendingApprovers[0].roleName}.`}
              </p>
            </div>
          )}

          <Timeline detail={detail} />
        </div>
      </div>

      {/* sticky action bar */}
      {detail.status === 'pending' && myStep && (
        <div className="border-t border-rule bg-surface p-3">
          {error && <p className="mb-2 text-sm text-reject">{error}</p>}
          {rejecting && (
            <div className="mb-2">
              <Textarea
                autoFocus
                rows={2}
                placeholder="A reason is required to reject"
                aria-label="Rejection reason"
                className="text-sm"
                value={rejectComment}
                onChange={(e) => setRejectComment(e.target.value)}
              />
            </div>
          )}
          {delegating && (
            <div className="mb-2 flex items-center gap-2">
              <select
                aria-label="Delegate to"
                className="h-9 flex-1 rounded-[6px] border border-rule bg-surface px-2 text-base"
                value={delegateTo}
                onChange={(e) => setDelegateTo(e.target.value)}
              >
                <option value="">Choose a person…</option>
                {myStep.eligibleUsers
                  .filter((user) => user.id !== me?.id)
                  .map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
              </select>
              <Button
                disabled={!delegateTo || busy}
                onClick={() => void act('delegate', { toUserId: delegateTo })}
              >
                Delegate step
              </Button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              disabled={busy || (rejecting && rejectComment.trim().length === 0)}
              onClick={() => {
                if (!rejecting) {
                  setRejecting(true);
                  setDelegating(false);
                  return;
                }
                void act('reject', { comment: rejectComment });
              }}
            >
              {rejecting ? 'Confirm rejection' : 'Reject'}
            </Button>
            {rejecting && (
              <Button variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => {
                setDelegating((prev) => !prev);
                setRejecting(false);
              }}
            >
              Delegate
            </Button>
            <span className="flex-1" />
            <Button
              variant="primary"
              disabled={busy}
              data-inbox-approve
              onClick={() => void act('approve')}
            >
              Approve
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
