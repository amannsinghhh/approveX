/**
 * Onboarding templates (Phase 7): each one is a complete, working approval
 * setup — roles, fields, a published rule, a published workflow, a binding —
 * created live by the wizard through the normal APIs. Nothing magic: what the
 * wizard builds is exactly what you could build by hand.
 */

interface TemplateRole {
  name: string;
  description: string;
}

export interface Template {
  id: string;
  name: string;
  tagline: string;
  context: string;
  fields: { name: string; type: 'number' | 'string' | 'boolean' | 'date'; description: string }[];
  roles: TemplateRole[];
  rule: { name: string; priority: number; conditionAst: unknown; summary: string };
  /** roleIds arrive in the same order as `roles`. */
  workflow: { name: string; graph: (roleIds: string[]) => unknown };
  /** Payload guaranteed to match — powers the live test. */
  samplePayload: Record<string, unknown>;
  sampleTitle: string;
}

const approval = (
  id: string,
  roleId: string,
  slaHours: number,
  position: { x: number; y: number },
  label?: string,
): Record<string, unknown> => ({
  id,
  type: 'approval',
  label,
  config: { roleId, quorum: 'any', slaHours },
  position,
});

export const TEMPLATES: Template[] = [
  {
    id: 'payments',
    name: 'Payment approvals',
    tagline: 'Payments above ₹5,00,000 need a Finance sign-off before they leave the account.',
    context: 'PAYMENTS',
    fields: [
      { name: 'amount', type: 'number', description: 'Payment amount in INR' },
      { name: 'vendor_name', type: 'string', description: 'Who is being paid' },
      { name: 'payment_mode', type: 'string', description: 'NEFT / RTGS / UPI' },
    ],
    roles: [{ name: 'Finance Head', description: 'Approves high-value payments' }],
    rule: {
      name: 'Payments above 5L',
      priority: 100,
      conditionAst: { field: 'amount', operator: '>', value: 500000 },
      summary: 'amount > ₹5,00,000',
    },
    workflow: {
      name: 'Finance sign-off',
      graph: (roleIds) => ({
        nodes: [
          { id: 'start', type: 'start', position: { x: 60, y: 140 } },
          approval('finance', roleIds[0] ?? '', 48, { x: 340, y: 140 }, 'Finance approval'),
          { id: 'done', type: 'auto_approve', position: { x: 620, y: 140 } },
        ],
        edges: [
          { from: 'start', to: 'finance' },
          { from: 'finance', to: 'done' },
        ],
      }),
    },
    samplePayload: { amount: 840000, vendor_name: 'Sharma Steel Ltd', payment_mode: 'RTGS' },
    sampleTitle: 'Vendor payment — Sharma Steel',
  },
  {
    id: 'expenses',
    name: 'Expense claims',
    tagline: 'Claims above ₹25,000 go to the manager, then Finance. Small claims sail through.',
    context: 'EXPENSES',
    fields: [
      { name: 'amount', type: 'number', description: 'Claim amount in INR' },
      { name: 'category', type: 'string', description: 'travel / meals / equipment' },
      { name: 'employee_name', type: 'string', description: 'Who is claiming' },
    ],
    roles: [
      { name: 'Manager', description: 'First-line expense approval' },
      { name: 'Finance Head', description: 'Final expense sign-off' },
    ],
    rule: {
      name: 'Expenses above 25K',
      priority: 100,
      conditionAst: { field: 'amount', operator: '>', value: 25000 },
      summary: 'amount > ₹25,000',
    },
    workflow: {
      name: 'Manager then Finance',
      graph: (roleIds) => ({
        nodes: [
          { id: 'start', type: 'start', position: { x: 60, y: 140 } },
          approval('manager', roleIds[0] ?? '', 24, { x: 320, y: 140 }, 'Manager approval'),
          approval('finance', roleIds[1] ?? '', 48, { x: 580, y: 140 }, 'Finance approval'),
          { id: 'done', type: 'auto_approve', position: { x: 840, y: 140 } },
        ],
        edges: [
          { from: 'start', to: 'manager' },
          { from: 'manager', to: 'finance' },
          { from: 'finance', to: 'done' },
        ],
      }),
    },
    samplePayload: { amount: 48000, category: 'travel', employee_name: 'Rohit Verma' },
    sampleTitle: 'Travel claim — Rohit Verma',
  },
  {
    id: 'vendors',
    name: 'Vendor onboarding',
    tagline: 'Big or foreign vendors clear Procurement and Compliance before the first PO.',
    context: 'VENDOR_ONBOARDING',
    fields: [
      { name: 'vendor_name', type: 'string', description: 'Legal entity name' },
      { name: 'country', type: 'string', description: 'Country of incorporation (ISO code)' },
      { name: 'annual_value', type: 'number', description: 'Expected annual spend in INR' },
    ],
    roles: [
      { name: 'Procurement Head', description: 'Commercial due diligence' },
      { name: 'Compliance', description: 'KYC and sanctions checks' },
    ],
    rule: {
      name: 'High-value or foreign vendors',
      priority: 100,
      conditionAst: {
        operator: 'OR',
        children: [
          { field: 'annual_value', operator: '>', value: 1000000 },
          { field: 'country', operator: '!=', value: 'IN' },
        ],
      },
      summary: 'annual_value > ₹10,00,000 OR country ≠ IN',
    },
    workflow: {
      name: 'Procurement + Compliance',
      graph: (roleIds) => ({
        nodes: [
          { id: 'start', type: 'start', position: { x: 60, y: 140 } },
          approval('procurement', roleIds[0] ?? '', 72, { x: 320, y: 60 }, 'Procurement'),
          approval('compliance', roleIds[1] ?? '', 72, { x: 320, y: 220 }, 'Compliance'),
          { id: 'done', type: 'auto_approve', position: { x: 600, y: 140 } },
        ],
        edges: [
          { from: 'start', to: 'procurement' },
          { from: 'start', to: 'compliance' },
          { from: 'procurement', to: 'done' },
          { from: 'compliance', to: 'done' },
        ],
      }),
    },
    samplePayload: { vendor_name: 'Acme GmbH', country: 'DE', annual_value: 2400000 },
    sampleTitle: 'New vendor — Acme GmbH',
  },
  {
    id: 'discounts',
    name: 'Discount approvals',
    tagline: 'Sales can close fast — but discounts past 15% get a quick leadership check.',
    context: 'DISCOUNT_APPROVAL',
    fields: [
      { name: 'discount_pct', type: 'number', description: 'Requested discount percentage' },
      { name: 'deal_size', type: 'number', description: 'Deal value in INR' },
      { name: 'customer_name', type: 'string', description: 'Customer on the deal' },
    ],
    roles: [{ name: 'Sales Head', description: 'Approves non-standard discounts' }],
    rule: {
      name: 'Discounts above 15%',
      priority: 100,
      conditionAst: { field: 'discount_pct', operator: '>', value: 15 },
      summary: 'discount_pct > 15',
    },
    workflow: {
      name: 'Sales leadership check',
      graph: (roleIds) => ({
        nodes: [
          { id: 'start', type: 'start', position: { x: 60, y: 140 } },
          approval('sales_head', roleIds[0] ?? '', 12, { x: 340, y: 140 }, 'Sales Head'),
          { id: 'done', type: 'auto_approve', position: { x: 620, y: 140 } },
        ],
        edges: [
          { from: 'start', to: 'sales_head' },
          { from: 'sales_head', to: 'done' },
        ],
      }),
    },
    samplePayload: { discount_pct: 22, deal_size: 1500000, customer_name: 'Nimbus Retail' },
    sampleTitle: 'Discount request — Nimbus Retail',
  },
  {
    id: 'purchase-orders',
    name: 'Purchase orders',
    tagline: 'POs above ₹1,00,000 need the department head, then the CFO office.',
    context: 'PURCHASE_ORDERS',
    fields: [
      { name: 'amount', type: 'number', description: 'PO value in INR' },
      { name: 'department', type: 'string', description: 'Requesting department' },
      { name: 'item_summary', type: 'string', description: 'What is being bought' },
    ],
    roles: [
      { name: 'Department Head', description: 'Confirms the need' },
      { name: 'CFO Office', description: 'Budget clearance' },
    ],
    rule: {
      name: 'POs above 1L',
      priority: 100,
      conditionAst: { field: 'amount', operator: '>', value: 100000 },
      summary: 'amount > ₹1,00,000',
    },
    workflow: {
      name: 'Dept Head then CFO',
      graph: (roleIds) => ({
        nodes: [
          { id: 'start', type: 'start', position: { x: 60, y: 140 } },
          approval('dept_head', roleIds[0] ?? '', 24, { x: 320, y: 140 }, 'Department Head'),
          approval('cfo', roleIds[1] ?? '', 48, { x: 580, y: 140 }, 'CFO Office'),
          { id: 'done', type: 'auto_approve', position: { x: 840, y: 140 } },
        ],
        edges: [
          { from: 'start', to: 'dept_head' },
          { from: 'dept_head', to: 'cfo' },
          { from: 'cfo', to: 'done' },
        ],
      }),
    },
    samplePayload: { amount: 380000, department: 'Operations', item_summary: '20 workstations' },
    sampleTitle: 'PO — 20 workstations',
  },
];
