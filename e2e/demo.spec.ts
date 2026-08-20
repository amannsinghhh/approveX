/**
 * ApproveX — narrated demo recording (pnpm demo:record).
 *
 * Drives the real app end to end in ONE browser page so Playwright's video
 * comes out as a single continuous walkthrough: sign up → setup wizard →
 * build & publish a rule → workflow canvas → sandbox dry-run → a real
 * request via the public API → second user approves in the inbox
 * (maker-checker: the creator can't) → the immutable audit log → analytics.
 *
 * Captions are injected as a bottom overlay per step, with readable pauses,
 * so the video works as a tutorial without a voiceover. The run creates a
 * fresh organization each time (timestamped emails) — it never touches
 * existing data.
 */
import { expect, test, type Page } from '@playwright/test';

const ts = Date.now();
// Slugs are unique per tenant — suffix the org so every recording is fresh.
const ORG = `Meridian Traders ${ts.toString(36).slice(-4).toUpperCase()}`;
const OWNER = { name: 'Priya Nair', email: `priya.${ts}@demo.test`, password: 'Demo-pass-1234' };
const APPROVER = { name: 'Rohan Iyer', email: `rohan.${ts}@demo.test`, password: 'Demo-pass-1234' };
const SAMPLE_PAYLOAD = { amount: 840000, vendor_name: 'Sharma Steel Ltd', payment_mode: 'RTGS' };

/** Bottom-bar caption + a pause long enough to read it. */
async function caption(page: Page, step: string, text: string, holdMs = 2400): Promise<void> {
  await page.evaluate(
    ([stepLabel, body]) => {
      let bar = document.getElementById('demo-caption');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'demo-caption';
        bar.style.cssText = [
          'position:fixed',
          'left:50%',
          'bottom:28px',
          'transform:translateX(-50%)',
          'z-index:999999',
          'max-width:900px',
          'padding:14px 22px',
          'border-radius:10px',
          'background:rgba(22,24,29,0.92)',
          'color:#fff',
          'font-family:"Schibsted Grotesk",system-ui,sans-serif',
          'font-size:16px',
          'line-height:1.45',
          'box-shadow:0 12px 32px rgba(0,0,0,0.35)',
          'pointer-events:none',
          'display:flex',
          'gap:14px',
          'align-items:baseline',
        ].join(';');
        document.body.appendChild(bar);
      }
      bar.innerHTML = `<span style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#8bb4ff;white-space:nowrap">${stepLabel}</span><span>${body}</span>`;
    },
    [step, text] as const,
  );
  await page.waitForTimeout(holdMs);
}

/** Short beat between actions so the viewer can follow the cursor. */
const beat = (page: Page, ms = 1200): Promise<void> => page.waitForTimeout(ms);

test('ApproveX full walkthrough', async ({ page }) => {
  // ── 1 · Sign up ────────────────────────────────────────────────────────
  await page.goto('/signup');
  await caption(page, 'Step 1 · Sign up', 'Create an organization — no credit card, no sales call.');
  await page.locator('#tenantName').fill(ORG);
  await page.locator('#name').fill(OWNER.name);
  await page.locator('#email').fill(OWNER.email);
  await page.locator('#password').fill(OWNER.password);
  await beat(page, 800);
  await page.getByRole('button', { name: 'Create organization' }).click();

  // ── 2 · Setup wizard ───────────────────────────────────────────────────
  await expect(page.getByText('step 1 / 3 · choose')).toBeVisible();
  await caption(
    page,
    'Step 2 · Setup wizard',
    'Pick a template — ApproveX assembles roles, fields, a rule, and a workflow through its own public APIs.',
  );
  await page.getByRole('button', { name: /Payment approvals/ }).click();
  await caption(
    page,
    'Step 2 · Setup wizard',
    'Every line is a real API call landing live — nothing is mocked.',
    3200,
  );
  await expect(page.getByRole('heading', { name: 'It works.' })).toBeVisible({ timeout: 60_000 });
  await caption(
    page,
    'Step 2 · Setup wizard',
    'And the payoff: a sample payment just evaluated against the live rule.',
    3000,
  );

  // Invite the approver while we're here (maker-checker needs a second human).
  await caption(
    page,
    'Step 2 · Setup wizard',
    'You can never approve your own requests — so invite the person who will.',
  );
  await page.locator('#invite-email').fill(APPROVER.email);
  await page.getByRole('button', { name: 'Invite', exact: true }).click();
  const inviteLink = (await page.locator('p.break-all').textContent())?.trim();
  expect(inviteLink).toContain('/accept-invite?token=');
  await beat(page, 1500);

  // ── 3 · Build & publish a rule ─────────────────────────────────────────
  await page.getByRole('button', { name: 'See the workflow on canvas' }).click();
  await page.getByRole('link', { name: 'Rules' }).click();
  await caption(
    page,
    'Step 3 · Rule Builder',
    'Rules are versioned and immutable once published. Let’s add one for urgent payments.',
  );
  await page.getByRole('button', { name: 'New rule' }).click();
  await page.getByLabel('Rule name').fill('Urgent payments above 10L');
  await page.locator('#context').fill('PAYMENTS');
  await page.locator('#priority').fill('200');
  await beat(page);

  await caption(
    page,
    'Step 3 · Rule Builder',
    'Conditions read like a sentence. The builder grows with the rule — nothing is boxed into one screen.',
  );
  const row = page.locator('[data-ast-path="root"]');
  await row.getByLabel('Field').first().selectOption('amount');
  await row.getByLabel('Operator').first().selectOption('>');
  await row.getByLabel('Value').first().fill('1000000');
  await beat(page);

  await caption(
    page,
    'Step 3 · Rule Builder',
    'The docked test panel runs the SAME evaluator the API uses — verdict updates as you type.',
  );
  await page.locator('#test-payload').fill('{\n  "amount": 2000000\n}');
  await beat(page, 2200);

  await page.getByRole('button', { name: 'Save draft' }).click();
  await beat(page);
  await page.getByRole('button', { name: 'Publish rule' }).click();
  await page.getByRole('button', { name: /Publish v1/ }).click();
  await caption(page, 'Step 3 · Rule Builder', 'Published. v1 is now immutable — edits create v2.', 2600);

  // ── 4 · Workflow canvas ────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Workflows' }).click();
  await page.getByText('Finance sign-off').first().click();
  await expect(page.locator('.react-flow')).toBeVisible();
  await caption(
    page,
    'Step 4 · Workflow Builder',
    'The approval flow the wizard built — full-bleed canvas, nodes color-coded by type.',
    2800,
  );
  await page.getByText('Finance approval').first().click();
  await caption(
    page,
    'Step 4 · Workflow Builder',
    'Selecting a node slides in its configuration: role, quorum, SLA, escalation.',
    2800,
  );

  // Drag a node from the palette onto the canvas — it's a real editor.
  const palette = page.getByRole('button', { name: 'Parallel fork' });
  const canvas = page.locator('.react-flow__pane');
  await caption(page, 'Step 4 · Workflow Builder', 'The palette drags straight onto the canvas.');
  await palette.dragTo(canvas, { targetPosition: { x: 700, y: 420 } });
  await beat(page, 1800);

  // ── 5 · Sandbox ────────────────────────────────────────────────────────
  await page.getByRole('link', { name: 'Sandbox' }).click();
  await caption(
    page,
    'Step 5 · Sandbox',
    'Dry-run the decision your ERP would ask for — server-side, zero side effects.',
  );
  await page.locator('#ctx').fill('PAYMENTS');
  await page.getByLabel('Payload').fill(JSON.stringify(SAMPLE_PAYLOAD, null, 2));
  await page.getByRole('button', { name: 'Run dry-run' }).click();
  await caption(
    page,
    'Step 5 · Sandbox',
    'Matched — with the full evaluation trace as a receipt.',
    3000,
  );

  // ── 6 · The approver joins (maker-checker needs a second human) ────────
  // Keep the owner's token: the "ERP" will submit the request as the owner
  // while the screen belongs to the approver.
  const ownerAccess = await page.evaluate(() => localStorage.getItem('approvex.access') ?? '');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto(inviteLink ?? '');
  await caption(
    page,
    'Step 6 · The approver',
    `${APPROVER.name} opens the invite — a two-field join, then straight to work.`,
  );
  await page.locator('#invite-name').fill(APPROVER.name);
  await page.locator('#invite-password').fill(APPROVER.password);
  await beat(page, 800);
  await page.getByRole('button', { name: 'Join and open my inbox' }).click();
  await page.getByRole('link', { name: 'Inbox' }).click();
  await caption(page, 'Step 6 · The approver', 'Finance Head is on board. Inbox: all clear — for now.', 2600);

  // ── 7 · A real request arrives via the public API ──────────────────────
  await caption(
    page,
    'Step 7 · Real request',
    'Meanwhile the ERP POSTs to /evaluate before the money moves — no UI involved.',
  );
  const evaluateResponse = await page.evaluate(
    async ({ payload, key, token }) => {
      const res = await fetch('/api/v1/evaluate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Idempotency-Key': key,
        },
        body: JSON.stringify({ context: 'PAYMENTS', data: payload, mode: 'execute' }),
      });
      return (await res.json()) as { requestId?: string; status?: string; message?: string };
    },
    { payload: SAMPLE_PAYLOAD, key: `demo-${ts}`, token: ownerAccess },
  );
  expect(evaluateResponse.requestId, JSON.stringify(evaluateResponse)).toBeTruthy();

  await page.reload();
  await caption(
    page,
    'Step 7 · Real request',
    'It lands in the approver’s inbox, pinned to the exact rule and workflow versions it matched.',
    2800,
  );
  // The two-pane inbox preselects the first (only) item — approve it.
  await beat(page);
  await page.locator('[data-inbox-approve]').first().click();
  await caption(page, 'Step 7 · Real request', 'Approved — the stamp lands and the webhook fires.', 3000);

  // ── 8 · Audit log ──────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.goto('/login');
  await page.locator('#email').fill(OWNER.email);
  await page.locator('#password').fill(OWNER.password);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.getByRole('link', { name: 'Audit log' }).click();
  await caption(
    page,
    'Step 8 · Audit log',
    'Every state change, append-only — a Postgres trigger rejects UPDATE and DELETE on audit rows.',
    3400,
  );

  // ── 9 · Analytics finale ───────────────────────────────────────────────
  await page.getByRole('link', { name: 'Analytics' }).click();
  await caption(
    page,
    'Step 9 · Analytics',
    'Approval rate, time-to-decision, and the step where requests actually get stuck.',
    3400,
  );
  await caption(
    page,
    'ApproveX',
    'Rules and workflows without code changes — one POST before the decision. That’s the product.',
    3600,
  );
});
