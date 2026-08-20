import React from 'react';
import { scrollToIssue, type HumanizedIssue } from '../lib/issue-language';

/** Clickable validation-issue list shared by the rule builder and DT editor.
 * Clicking an issue scrolls to (and flashes) the offending element.
 * `showPaths` reveals the raw machine path — reserved for technical roles. */
export function IssueList({
  issues,
  showPaths = false,
  className = '',
}: {
  issues: HumanizedIssue[];
  showPaths?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <ul className={`flex flex-col gap-1.5 ${className}`}>
      {issues.map((issue, index) => (
        <li key={index}>
          <button
            type="button"
            onClick={() => scrollToIssue(issue.anchor)}
            disabled={!issue.anchor}
            className={`w-full rounded-[6px] border border-rule bg-surface px-2.5 py-1.5 text-left text-sm ${
              issue.anchor ? 'cursor-pointer hover:border-reject/60' : 'cursor-default'
            }`}
          >
            <span className="font-medium text-reject">{issue.location}</span>
            <span className="text-ink"> — {issue.message}</span>
            {issue.hint && <span className="mt-0.5 block text-ink-soft">{issue.hint}</span>}
            {showPaths && (
              <span className="mt-0.5 block font-mono text-xs text-ink-soft">{issue.path}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
