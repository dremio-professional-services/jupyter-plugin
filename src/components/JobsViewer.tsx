import * as React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import { DremioCredentials, JobItem, fetchJobs } from '../api';

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = [
  { label: 'Completed',    value: 'COMPLETED',    cls: 'completed'   },
  { label: 'Cancelled',    value: 'CANCELLED',    cls: 'cancelled'   },
  { label: 'Failed',       value: 'FAILED',       cls: 'failed'      },
  { label: 'Queued',       value: 'QUEUED',       cls: 'queued'      },
  { label: 'Setup',        value: 'PLANNING',     cls: 'planning'    },
  { label: 'Engine Start', value: 'ENGINE_START', cls: 'engine-start'},
];

const ALL_STATUS_VALUES = new Set(STATUS_OPTIONS.map(s => s.value));

// Also match ENQUEUED when QUEUED is selected
function stateMatches(state: string, selected: Set<string>): boolean {
  if (selected.has(state)) return true;
  if (state === 'ENQUEUED' && selected.has('QUEUED')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  } catch { return iso; }
}

function formatDuration(startedAt: string, endedAt: string): string {
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

const QUERY_TYPE_LABELS: Record<string, string> = {
  UI_RUN:              'Run',
  UI_PREVIEW:          'Preview',
  UI_EXPORT:           'Export',
  ODBC:                'ODBC',
  JDBC:                'JDBC',
  REST:                'REST',
  ACCELERATOR_CREATE:  'Refl. Create',
  ACCELERATOR_DROP:    'Refl. Drop',
  ACCELERATOR_EXPLAIN: 'Refl. Explain',
  PREPARE_INTERNAL:    'Internal',
  UNKNOWN:             'Unknown',
};

function fmtQueryType(s?: string): string {
  if (!s) return '—';
  return QUERY_TYPE_LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const STATE_LABELS: Record<string, string> = {
  COMPLETED:          'Completed',
  CANCELLED:          'Cancelled',
  FAILED:             'Failed',
  RUNNING:            'Running',
  QUEUED:             'Queued',
  ENQUEUED:           'Queued',
  PLANNING:           'Setup',
  ENGINE_START:       'Eng. Start',
  STARTING:           'Starting',
  METADATA_RETRIEVAL: 'Metadata',
  EXECUTION_PLANNING: 'Exec. Plan',
  NOT_SUBMITTED:      'Not Submitted',
};

function fmtState(s: string): string {
  return STATE_LABELS[s] ?? s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Map state → CSS class (some states share a colour)
function stateClass(s: string): string {
  const map: Record<string, string> = {
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    FAILED: 'failed',
    RUNNING: 'running',
    QUEUED: 'queued', ENQUEUED: 'queued',
    PLANNING: 'planning',
    ENGINE_START: 'engine-start',
    STARTING: 'starting',
    METADATA_RETRIEVAL: 'running',
    EXECUTION_PLANNING: 'running',
  };
  return map[s] ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  key: string;
  label: string;
  render: (j: JobItem) => React.ReactNode;
}

const ALL_COLUMNS: ColumnDef[] = [
  {
    key: 'id',
    label: 'Job ID',
    render: j => (
      <span className="dremio-jobs-mono" title={j.id}>
        {j.id.length > 8 ? j.id.slice(0, 8) + '…' : j.id}
      </span>
    ),
  },
  {
    key: 'user',
    label: 'User',
    render: j => j.user || '—',
  },
  {
    key: 'acceleration',
    label: '⚡',
    render: j => j.acceleration ? (
      <span className="dremio-jobs-accel" title="Uses acceleration">⚡</span>
    ) : null,
  },
  {
    key: 'dataset',
    label: 'Dataset',
    render: j => {
      const path = j.datasetPathList ?? [];
      const name = path[path.length - 1] ?? '—';
      return <span title={path.join('.')}>{name}</span>;
    },
  },
  {
    key: 'attribute',
    label: 'Attribute',
    render: j => fmtQueryType(j.queryType),
  },
  {
    key: 'startedAt',
    label: 'Queue Start Time',
    render: j => {
      const ts = j.resourceSchedulingInfo?.resourceSchedulingStart ?? j.startedAt;
      return ts ? formatDateTime(ts) : '—';
    },
  },
  {
    key: 'duration',
    label: 'Duration',
    render: j => j.startedAt && j.endedAt
      ? formatDuration(j.startedAt, j.endedAt)
      : '—',
  },
  {
    key: 'sql',
    label: 'SQL',
    render: j => {
      const sql = j.description ?? '';
      const short = sql.length > 120 ? sql.slice(0, 120) + '…' : sql;
      return <span className="dremio-jobs-sql" title={sql}>{short}</span>;
    },
  },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.map(c => c.key);

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  creds: DremioCredentials;
}

export function JobsViewer({ creds }: Props): JSX.Element {
  const [jobs, setJobs]                   = useState<JobItem[]>([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [selectedStatuses, setStatuses]   = useState<Set<string>>(new Set(ALL_STATUS_VALUES));
  const [visibleColumns, setVisible]      = useState<string[]>(DEFAULT_VISIBLE);
  const [colDropdownOpen, setColOpen]     = useState(false);
  const dropdownRef                        = useRef<HTMLDivElement>(null);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchJobs(creds);
      setJobs(result.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [creds]);

  useEffect(() => { void loadJobs(); }, [loadJobs]);

  // Close column dropdown on outside click
  useEffect(() => {
    if (!colDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setColOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [colDropdownOpen]);

  const toggleStatus = (value: string) => {
    setStatuses(prev => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const toggleColumn = (key: string) => {
    setVisible(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const isAllSelected = selectedStatuses.size === STATUS_OPTIONS.length;

  const filteredJobs = isAllSelected
    ? jobs
    : jobs.filter(j => stateMatches(j.state, selectedStatuses));

  const cols = ALL_COLUMNS.filter(c => visibleColumns.includes(c.key));

  return (
    <div className="dremio-jobs">
      <div className="dremio-jobs-layout">

        {/* ── Left sidebar ──────────────────────────────────────── */}
        <div className="dremio-jobs-sidebar">
          <div className="dremio-jobs-sidebar-title">Status</div>
          <label className="dremio-jobs-status-label dremio-jobs-status-all">
            <input
              type="checkbox"
              checked={isAllSelected}
              onChange={() =>
                setStatuses(isAllSelected
                  ? new Set()
                  : new Set(ALL_STATUS_VALUES)
                )
              }
            />
            <span>All</span>
          </label>
          {STATUS_OPTIONS.map(opt => (
            <label key={opt.value} className="dremio-jobs-status-label">
              <input
                type="checkbox"
                checked={selectedStatuses.has(opt.value)}
                onChange={() => toggleStatus(opt.value)}
              />
              <span className={`dremio-jobs-dot dremio-jobs-dot--${opt.cls}`} />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>

        {/* ── Main area ─────────────────────────────────────────── */}
        <div className="dremio-jobs-main">

          {/* Top toolbar */}
          <div className="dremio-jobs-topbar">
            <div className="dremio-jobs-col-wrapper" ref={dropdownRef}>
              <button
                className="dremio-jobs-col-btn"
                onClick={() => setColOpen(prev => !prev)}
              >
                Columns ▾
              </button>
              {colDropdownOpen && (
                <div className="dremio-jobs-col-dropdown">
                  {ALL_COLUMNS.map(col => (
                    <label key={col.key} className="dremio-jobs-col-option">
                      <input
                        type="checkbox"
                        checked={visibleColumns.includes(col.key)}
                        onChange={() => toggleColumn(col.key)}
                      />
                      {col.label}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <span className="dremio-jobs-topbar-spacer" />

            <span className="dremio-jobs-count">
              {!loading && `${filteredJobs.length} jobs`}
            </span>

            <button
              className="dremio-jobs-refresh-btn"
              onClick={() => void loadJobs()}
              disabled={loading}
              title="Reload jobs from Dremio"
            >
              ↺ Refresh
            </button>
          </div>

          {/* Error banner */}
          {error && <div className="dremio-jobs-error">{error}</div>}

          {/* Table */}
          <div className="dremio-jobs-table-wrap">
            <table className="dremio-jobs-table">
              <thead>
                <tr>
                  <th className="dremio-jobs-th dremio-jobs-th--state">State</th>
                  {cols.map(c => (
                    <th key={c.key} className={`dremio-jobs-th dremio-jobs-th--${c.key}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={cols.length + 1} className="dremio-jobs-placeholder">
                      Loading jobs…
                    </td>
                  </tr>
                )}
                {!loading && filteredJobs.length === 0 && !error && (
                  <tr>
                    <td colSpan={cols.length + 1} className="dremio-jobs-placeholder">
                      No jobs match the selected filters.
                    </td>
                  </tr>
                )}
                {filteredJobs.map(job => (
                  <tr key={job.id} className="dremio-jobs-row">
                    <td className="dremio-jobs-td dremio-jobs-td--state">
                      <span
                        className={`dremio-jobs-badge dremio-jobs-badge--${stateClass(job.state)}`}
                        title={job.state}
                      >
                        {fmtState(job.state)}
                      </span>
                    </td>
                    {cols.map(c => (
                      <td key={c.key} className={`dremio-jobs-td dremio-jobs-td--${c.key}`}>
                        {c.render(job)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
