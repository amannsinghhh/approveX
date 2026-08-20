/**
 * Decision table grid editor (UI spec §5.2 hint + spec §5, addendum C):
 * columns are fields, cells use the shared grammar (*, > 500000, 50000..500000,
 * a, b, @List), enum-typed columns edit as value chips (a multiselect compiles
 * to the IN-list grammar), and each row binds one or more named outputs plus an
 * optional nested-table chain (decisionTableRef). Test panel evaluates locally
 * via @approvex/shared, resolving chained tables from their published heads.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import type {
  DecisionTableColumn,
  DecisionTableDefinition,
  DecisionTableResolver,
  DecisionTableRow,
  FieldSchema,
  HitPolicy,
} from '@approvex/shared';
import {
  DECISION_TABLE_REF_KEY,
  evaluateDecisionTable,
  validateDecisionTable,
} from '@approvex/shared';
import { PageHeader } from '../components/AppShell';
import { FieldHelp } from '../components/FieldHelp';
import { IssueList } from '../components/IssueList';
import { StampChip } from '../components/StampChip';
import { Button, Card, Input, Label, Segmented, Textarea } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { humanizeTableIssue } from '../lib/issue-language';
import type { DecisionTable, FieldDefinition, Paginated } from '../lib/types';

const DEFAULT_OUTPUT_KEY = 'workflow';

interface EditorRow {
  cells: string[];
  /** One value per output key, aligned with `outputKeys`. */
  outputs: string[];
  /** Nested decision-table reference (blank = none). */
  ref: string;
  priority?: number;
}

/** Renders a stored output value back to editable text; quoting round-trips. */
function displayOutputValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    // Quote strings that would otherwise re-parse as a number/boolean.
    if (/^-?\d+(\.\d+)?$/.test(value) || value === 'true' || value === 'false') {
      return JSON.stringify(value);
    }
    return value;
  }
  return JSON.stringify(value);
}

/** Parses an output cell: numbers and booleans coerce, quoted "42" stays text. */
function parseOutputValue(raw: string): unknown {
  const text = raw.trim();
  if (text === '') return undefined;
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (text === 'true') return true;
  if (text === 'false') return false;
  return text;
}

/**
 * Reads a condition cell as an enum multiselect. Returns the selected values,
 * or null when the cell uses grammar the chips can't express (ranges,
 * comparisons, @lists, unknown values) and must stay a text input.
 */
function enumSelection(cell: string, enumValues: string[]): string[] | null {
  const text = cell.trim();
  if (text === '' || text === '*') return [];
  const parts = text.split(',').map((part) => part.trim());
  if (parts.every((part) => part.length > 0 && enumValues.includes(part))) return parts;
  return null;
}

export function DecisionTableEditorPage(): React.JSX.Element {
  const { id } = useParams();
  const isNew = id === undefined;
  const navigate = useNavigate();
  const { can } = useAuth();

  const [table, setTable] = useState<DecisionTable | null>(null);
  const [name, setName] = useState('');
  const [context, setContext] = useState('PAYMENT_APPROVAL');
  const [hitPolicy, setHitPolicy] = useState<HitPolicy>('first');
  const [columns, setColumns] = useState<DecisionTableColumn[]>([{ field: 'amount' }]);
  const [outputKeys, setOutputKeys] = useState<string[]>([DEFAULT_OUTPUT_KEY]);
  const [rows, setRows] = useState<EditorRow[]>([{ cells: ['*'], outputs: [''], ref: '' }]);
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [tables, setTables] = useState<DecisionTable[]>([]);
  /** Head definitions of chained tables, keyed by name; null = fetch failed. */
  const [refDefs, setRefDefs] = useState<Record<string, DecisionTableDefinition | null>>({});
  /** Enum cells the author flipped to raw text (keys are `${row}:${col}`). */
  const [textCells, setTextCells] = useState<ReadonlySet<string>>(new Set());
  const [testPayload, setTestPayload] = useState('{\n  "amount": 200000\n}');
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<{ items: FieldDefinition[] }>('/fields').then((res) => setFields(res.items));
    void api<Paginated<DecisionTable>>('/decision-tables?pageSize=100').then((res) =>
      setTables(res.items),
    );
    if (!isNew && id) {
      void api<DecisionTable>(`/decision-tables/${id}`).then((loaded) => {
        setTable(loaded);
        setName(loaded.name);
        setContext(loaded.context);
        const head = loaded.versions?.[0] ?? loaded.latestVersion;
        if (head) {
          setHitPolicy(head.hitPolicy);
          setColumns(head.columns);
          const keys = new Set<string>();
          for (const row of head.rows) {
            for (const key of Object.keys(row.output)) {
              if (key !== DECISION_TABLE_REF_KEY) keys.add(key);
            }
          }
          const loadedKeys = keys.size > 0 ? [...keys] : [DEFAULT_OUTPUT_KEY];
          setOutputKeys(loadedKeys);
          setRows(
            head.rows.map((row: DecisionTableRow) => ({
              cells: row.cells,
              outputs: loadedKeys.map((key) => displayOutputValue(row.output[key])),
              ref: typeof row.output[DECISION_TABLE_REF_KEY] === 'string'
                ? String(row.output[DECISION_TABLE_REF_KEY])
                : '',
              priority: row.priority,
            })),
          );
        }
      });
    }
  }, [id, isNew]);

  // Fetch the head definition of every chained table once, for local testing.
  useEffect(() => {
    const names = [...new Set(rows.map((row) => row.ref.trim()).filter(Boolean))];
    for (const refName of names) {
      if (refName in refDefs) continue;
      const target = tables.find((t) => t.name === refName);
      if (!target) continue;
      setRefDefs((prev) => ({ ...prev, [refName]: null }));
      void api<DecisionTable>(`/decision-tables/${target.id}`)
        .then((detail) => {
          const head = detail.versions?.[0] ?? detail.latestVersion;
          setRefDefs((prev) => ({
            ...prev,
            [refName]: head
              ? { columns: head.columns, rows: head.rows, hitPolicy: head.hitPolicy }
              : null,
          }));
        })
        .catch(() => undefined);
    }
  }, [rows, tables, refDefs]);

  const fieldSchema = useMemo<FieldSchema>(
    () =>
      Object.fromEntries(
        fields.map((field) => [
          field.name,
          field.enumValues && field.enumValues.length > 0
            ? { type: field.type, enumValues: field.enumValues }
            : field.type,
        ]),
      ),
    [fields],
  );

  const resolveTable = useCallback<DecisionTableResolver>(
    (refName) => refDefs[refName] ?? undefined,
    [refDefs],
  );

  const trimmedKeys = useMemo(
    () => outputKeys.map((key) => key.trim()).filter((key) => key.length > 0),
    [outputKeys],
  );

  /** The definition sent to the API (the advisory `outputs` stays local-only). */
  const apiDefinition = useMemo(
    () => ({
      columns,
      rows: rows.map((row) => {
        const output: Record<string, unknown> = {};
        outputKeys.forEach((key, index) => {
          const trimmed = key.trim();
          if (!trimmed) return;
          const value = parseOutputValue(row.outputs[index] ?? '');
          if (value !== undefined) output[trimmed] = value;
        });
        if (row.ref.trim()) output[DECISION_TABLE_REF_KEY] = row.ref.trim();
        return {
          cells: row.cells,
          output,
          // priority only steers the "best" hit policy; omit it otherwise.
          ...(hitPolicy === 'best' && row.priority !== undefined
            ? { priority: row.priority }
            : {}),
        };
      }),
      hitPolicy,
    }),
    [columns, rows, outputKeys, hitPolicy],
  );

  const definition = useMemo(
    () => ({
      ...apiDefinition,
      ...(trimmedKeys.length > 0 ? { outputs: trimmedKeys } : {}),
    }),
    [apiDefinition, trimmedKeys],
  );

  const validation = useMemo(
    () => validateDecisionTable(definition, fieldSchema),
    [definition, fieldSchema],
  );

  const testResult = useMemo(() => {
    if (!validation.valid) return null;
    try {
      const data: unknown = JSON.parse(testPayload);
      return evaluateDecisionTable(definition, data, { fieldSchema, resolveTable });
    } catch {
      return null;
    }
  }, [validation.valid, definition, testPayload, fieldSchema, resolveTable]);

  const setCell = (rowIndex: number, cellIndex: number, value: string): void => {
    setRows((prev) =>
      prev.map((row, index) =>
        index === rowIndex
          ? { ...row, cells: row.cells.map((cell, ci) => (ci === cellIndex ? value : cell)) }
          : row,
      ),
    );
  };

  const setColumnField = (index: number, field: string): void => {
    setColumns((prev) => prev.map((column, i) => (i === index ? { field } : column)));
    setTextCells(new Set());
  };

  const addColumn = (): void => {
    setColumns((prev) => [...prev, { field: '' }]);
    setRows((prev) => prev.map((row) => ({ ...row, cells: [...row.cells, '*'] })));
    setTextCells(new Set());
  };

  const removeColumn = (index: number): void => {
    if (columns.length === 1) return;
    setColumns((prev) => prev.filter((_, i) => i !== index));
    setRows((prev) =>
      prev.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== index) })),
    );
    setTextCells(new Set());
  };

  const setOutputKey = (index: number, key: string): void => {
    setOutputKeys((prev) => prev.map((existing, i) => (i === index ? key : existing)));
  };

  const addOutputKey = (): void => {
    setOutputKeys((prev) => [...prev, '']);
    setRows((prev) => prev.map((row) => ({ ...row, outputs: [...row.outputs, ''] })));
  };

  const removeOutputKey = (index: number): void => {
    if (outputKeys.length === 1) return;
    setOutputKeys((prev) => prev.filter((_, i) => i !== index));
    setRows((prev) =>
      prev.map((row) => ({ ...row, outputs: row.outputs.filter((_, i) => i !== index) })),
    );
  };

  const setOutputValue = (rowIndex: number, keyIndex: number, value: string): void => {
    setRows((prev) =>
      prev.map((row, index) =>
        index === rowIndex
          ? { ...row, outputs: row.outputs.map((v, i) => (i === keyIndex ? value : v)) }
          : row,
      ),
    );
  };

  const save = async (): Promise<string | null> => {
    setBusy(true);
    setMessage(null);
    try {
      if (isNew) {
        const created = await api<DecisionTable>('/decision-tables', {
          method: 'POST',
          body: { name, context, ...apiDefinition },
        });
        setMessage({ tone: 'ok', text: 'Draft saved' });
        navigate(`/decision-tables/${created.id}`, { replace: true });
        return created.id;
      }
      if (table && name !== table.name) {
        await api(`/decision-tables/${id}`, { method: 'PATCH', body: { name } });
      }
      await api(`/decision-tables/${id}/draft`, { method: 'PUT', body: apiDefinition });
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
    const tableId = await save();
    if (!tableId) return;
    setBusy(true);
    try {
      const published = await api<{ version: number }>(`/decision-tables/${tableId}/publish`, {
        method: 'POST',
      });
      setMessage({ tone: 'ok', text: `Decision table published — v${published.version}` });
      setTable(await api<DecisionTable>(`/decision-tables/${tableId}`));
    } catch (err) {
      setMessage({
        tone: 'err',
        text: err instanceof ApiError ? err.message : 'Could not publish.',
      });
    } finally {
      setBusy(false);
    }
  };

  /** Enum values for a condition column, when its field is enum-typed. */
  const columnEnumValues = (column: DecisionTableColumn): string[] | undefined => {
    const field = fields.find((f) => f.name === column.field);
    return field?.enumValues && field.enumValues.length > 0 ? field.enumValues : undefined;
  };

  const otherTableNames = tables
    .filter((t) => t.id !== id && t.name !== name)
    .map((t) => t.name);

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Input
              aria-label="Decision table name"
              className="h-10 w-96 text-lg font-bold"
              placeholder="Payment routing"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <StampChip label={table?.status ?? 'draft'} />
          </span>
        }
        actions={
          <>
            {can('rule:create') && (
              <Button onClick={() => void save()} disabled={busy || !name}>
                Save draft
              </Button>
            )}
            {can('rule:publish') && (
              <Button
                variant="primary"
                disabled={busy || !name || !validation.valid}
                onClick={() => void publish()}
              >
                Publish table
              </Button>
            )}
          </>
        }
      />

      {message && (
        <p className={`mb-3 text-base ${message.tone === 'ok' ? 'text-approve' : 'text-reject'}`}>
          {message.text}
        </p>
      )}

      <div className="mb-4 flex items-end gap-4">
        <div>
          <Label htmlFor="context">Context</Label>
          <Input
            id="context"
            className="w-56 font-mono text-sm"
            value={context}
            disabled={!isNew}
            onChange={(e) => setContext(e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <Label>Hit policy</Label>
          <Segmented
            value={hitPolicy}
            options={[
              { value: 'first', label: 'First' },
              { value: 'all', label: 'All' },
              { value: 'best', label: 'Best' },
              { value: 'unique', label: 'Unique' },
            ]}
            onChange={setHitPolicy}
          />
          <p className="mt-0.5 max-w-md text-xs text-ink-soft">
            {hitPolicy === 'first' && 'The first matching row (top to bottom) fires.'}
            {hitPolicy === 'all' && 'Every matching row fires.'}
            {hitPolicy === 'best' && 'Among matches, the highest-priority row fires; ties break by row order.'}
            {hitPolicy === 'unique' && 'Exactly one row may match — overlapping rows are rejected at publish.'}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-[10px] border border-rule bg-surface">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="border-b border-rule">
              {columns.map((column, index) => (
                <th key={index} data-col-anchor={index} className="min-w-44 px-2 py-2 text-left">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={`Column ${index + 1} field`}
                      className="h-8 font-mono text-sm"
                      placeholder="field"
                      list="field-options"
                      value={column.field}
                      onChange={(e) => setColumnField(index, e.target.value)}
                    />
                    <Button
                      variant="ghost"
                      className="h-7 px-1"
                      aria-label="Remove column"
                      onClick={() => removeColumn(index)}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </th>
              ))}
              {outputKeys.map((key, index) => (
                <th key={`out-${index}`} className="min-w-44 px-2 py-2 text-left">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs text-ink-soft">→</span>
                    <Input
                      aria-label={`Output ${index + 1} name`}
                      className="h-8 font-mono text-sm"
                      placeholder={DEFAULT_OUTPUT_KEY}
                      value={key}
                      onChange={(e) => setOutputKey(index, e.target.value)}
                    />
                    {outputKeys.length > 1 && (
                      <Button
                        variant="ghost"
                        className="h-7 px-1"
                        aria-label="Remove output"
                        onClick={() => removeOutputKey(index)}
                      >
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </th>
              ))}
              <th className="min-w-44 px-2 py-2 text-left">
                <span className="flex items-center gap-1 font-mono text-xs uppercase tracking-wide text-ink-soft">
                  ↪ chains to
                  <FieldHelp>
                    When a row names another decision table, that table runs next (up to 3 levels
                    deep) and its outputs merge in. A chaining row may leave its own outputs blank.
                  </FieldHelp>
                </span>
              </th>
              {hitPolicy === 'best' && (
                <th className="w-24 px-2 py-2 text-left">
                  <span className="font-mono text-xs uppercase tracking-wide text-ink-soft">
                    priority
                  </span>
                </th>
              )}
              <th className="w-32 px-2 py-2 text-right">
                <span className="flex items-center justify-end gap-1">
                  <Button variant="ghost" className="h-7 text-sm" onClick={addColumn}>
                    <Plus size={13} /> Column
                  </Button>
                  <Button variant="ghost" className="h-7 text-sm" onClick={addOutputKey}>
                    <Plus size={13} /> Output
                  </Button>
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                data-row-anchor={rowIndex}
                className="border-b border-rule last:border-b-0"
              >
                {row.cells.map((cell, cellIndex) => {
                  const enumValues = columns[cellIndex]
                    ? columnEnumValues(columns[cellIndex])
                    : undefined;
                  const cellKey = `${rowIndex}:${cellIndex}`;
                  const selection =
                    enumValues && !textCells.has(cellKey)
                      ? enumSelection(cell, enumValues)
                      : null;
                  return (
                    <td key={cellIndex} className="px-2 py-1.5 align-top">
                      {enumValues && selection !== null ? (
                        <div
                          className="flex flex-wrap items-center gap-1"
                          role="group"
                          aria-label={`Row ${rowIndex + 1}, ${columns[cellIndex]?.field} values (none = any)`}
                        >
                          {enumValues.map((value) => {
                            const active = selection.includes(value);
                            return (
                              <button
                                key={value}
                                type="button"
                                aria-pressed={active}
                                className={`rounded-full border px-2 py-0.5 font-mono text-xs transition-colors ${
                                  active
                                    ? 'border-ink bg-ink text-surface'
                                    : 'border-rule text-ink-soft hover:border-ink'
                                }`}
                                onClick={() => {
                                  const next = active
                                    ? selection.filter((v) => v !== value)
                                    : [...selection, value];
                                  setCell(
                                    rowIndex,
                                    cellIndex,
                                    next.length === 0 ? '*' : next.join(', '),
                                  );
                                }}
                              >
                                {value}
                              </button>
                            );
                          })}
                          <Button
                            variant="ghost"
                            className="h-6 px-1"
                            aria-label="Edit cell as text"
                            onClick={() =>
                              setTextCells((prev) => new Set([...prev, cellKey]))
                            }
                          >
                            <Pencil size={11} />
                          </Button>
                        </div>
                      ) : (
                        <Input
                          aria-label={`Row ${rowIndex + 1}, ${columns[cellIndex]?.field || `column ${cellIndex + 1}`}`}
                          className="h-8 font-mono text-sm"
                          placeholder="*"
                          value={cell}
                          onChange={(e) => setCell(rowIndex, cellIndex, e.target.value)}
                          onBlur={() => {
                            // Return to chips once the text parses as plain values.
                            if (enumValues && enumSelection(cell, enumValues) !== null) {
                              setTextCells((prev) => {
                                const next = new Set(prev);
                                next.delete(cellKey);
                                return next;
                              });
                            }
                          }}
                        />
                      )}
                    </td>
                  );
                })}
                {outputKeys.map((key, keyIndex) => (
                  <td key={`out-${keyIndex}`} className="px-2 py-1.5 align-top">
                    <Input
                      aria-label={`Row ${rowIndex + 1} ${key.trim() || `output ${keyIndex + 1}`}`}
                      className="h-8 font-mono text-sm"
                      placeholder={key.trim() === DEFAULT_OUTPUT_KEY ? 'MANAGER_FINANCE' : 'value'}
                      value={row.outputs[keyIndex] ?? ''}
                      onChange={(e) =>
                        setOutputValue(
                          rowIndex,
                          keyIndex,
                          key.trim() === DEFAULT_OUTPUT_KEY
                            ? e.target.value.toUpperCase()
                            : e.target.value,
                        )
                      }
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 align-top">
                  <Input
                    aria-label={`Row ${rowIndex + 1} chains to table`}
                    className="h-8 font-mono text-sm"
                    placeholder="none"
                    list="table-options"
                    value={row.ref}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) => (i === rowIndex ? { ...r, ref: e.target.value } : r)),
                      )
                    }
                  />
                </td>
                {hitPolicy === 'best' && (
                  <td className="px-2 py-1.5 align-top">
                    <Input
                      type="number"
                      aria-label={`Row ${rowIndex + 1} priority`}
                      className="h-8 w-20 font-mono text-sm"
                      placeholder="0"
                      value={row.priority ?? ''}
                      onChange={(e) =>
                        setRows((prev) =>
                          prev.map((r, i) =>
                            i === rowIndex
                              ? { ...r, priority: e.target.value === '' ? undefined : Number(e.target.value) }
                              : r,
                          ),
                        )
                      }
                    />
                  </td>
                )}
                <td className="px-2 py-1.5 text-right align-top">
                  <span className="flex items-center justify-end gap-1">
                    {testResult?.rows[rowIndex]?.fired && (
                      <StampChip label="fires" tone="approve" />
                    )}
                    <Button
                      variant="ghost"
                      className="h-7 px-1"
                      aria-label="Remove row"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== rowIndex))}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="field-options">
          {fields.map((field) => (
            <option key={field.name} value={field.name} />
          ))}
        </datalist>
        <datalist id="table-options">
          {otherTableNames.map((tableName) => (
            <option key={tableName} value={tableName} />
          ))}
        </datalist>
        <div className="border-t border-rule p-2">
          <Button
            variant="ghost"
            className="h-7 text-sm"
            onClick={() =>
              setRows((prev) => [
                ...prev,
                { cells: columns.map(() => '*'), outputs: outputKeys.map(() => ''), ref: '' },
              ])
            }
          >
            <Plus size={13} /> Add row
          </Button>
        </div>
      </div>

      <p className="mt-2 font-mono text-xs text-ink-soft">
        Cell grammar: * any · &gt; 500000 · 50000..500000 · Finance, Procurement · @ListName ·
        quoted "42" stays text — output values coerce the same way
      </p>

      {!validation.valid && (
        <IssueList
          className="mt-3"
          issues={validation.issues.map((issue) =>
            humanizeTableIssue(
              issue,
              columns.map((column) => column.field),
            ),
          )}
          showPaths={can('rule:publish')}
        />
      )}

      <Card className="mt-5 p-4">
        <h3 className="mb-2 text-sm font-medium text-ink-soft">
          Test payload — rows that fire are stamped in the grid
        </h3>
        <Textarea
          aria-label="Test payload"
          rows={4}
          className="font-mono text-sm"
          value={testPayload}
          onChange={(e) => setTestPayload(e.target.value)}
        />
        {testResult && (
          <div className="mt-2 flex flex-col gap-1 font-mono text-sm text-ink">
            {testResult.anyMatch ? (
              testResult.outputs.map((output, index) => (
                <p key={index}>→ {JSON.stringify(output)}</p>
              ))
            ) : (
              <p>No row matches this payload.</p>
            )}
            {testResult.errors?.map((error, index) => (
              <p key={`err-${index}`} className="text-reject">
                {error.rowIndex !== undefined ? `Row ${error.rowIndex + 1}: ` : ''}
                {error.message}
              </p>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
