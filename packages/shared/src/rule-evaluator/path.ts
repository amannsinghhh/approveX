export interface PathResolution {
  found: boolean;
  value: unknown;
}

/**
 * Resolves a dot path with optional array indexes against a payload:
 * "amount", "vendor.country", "items[0].category", "matrix[1][2]".
 * `found: false` means a segment was absent — distinct from an explicit null.
 */
export function resolvePath(data: unknown, path: string): PathResolution {
  // "items[0].category" → ["items", "0", "category"]
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) return { found: false, value: undefined };

  let current: unknown = data;
  for (const segment of segments) {
    if (current === null || current === undefined) return { found: false, value: undefined };
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (typeof current !== 'object') return { found: false, value: undefined };
    if (!Object.prototype.hasOwnProperty.call(current, segment)) {
      return { found: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return { found: true, value: current };
}
