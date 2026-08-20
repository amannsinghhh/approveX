/** Attached to the request by JwtAuthGuard; permissions filled in by PermissionsGuard. */
export interface AuthUser {
  /** For API-key principals this is the key's id (a uuid that never matches a user). */
  userId: string;
  tenantId: string;
  email: string;
  permissions?: string[];
  /** Present when the caller authenticated with an `ax_...` API key. */
  apiKey?: { id: string; name: string; scopes: string[] };
}

/** What a machine credential may do. Human-only endpoints reject API keys outright. */
export const API_KEY_SCOPES = ['evaluate', 'request:create', 'request:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const PERMISSION_KEYS = [
  'rule:create',
  'rule:publish',
  'workflow:create',
  'workflow:publish',
  'request:approve',
  'audit:view',
  'member:manage',
  'webhook:manage',
  'apikey:manage',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
