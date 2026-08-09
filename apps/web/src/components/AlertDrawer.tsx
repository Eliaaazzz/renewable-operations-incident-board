import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ALERT_TYPE_META,
  NOTE_MAX_LENGTH,
  STATUS_LABEL,
  type AlertDetailResponse,
  type AlertEvent,
  type AlertNote,
  type AlertStatus,
  type Insight,
} from '@incident-board/shared';
import { api, ApiRequestError } from '../api/client';
import { useResource } from '../api/useResource';
import { formatCapacity, formatRelativeTime, formatSiteTime, humaniseKey, formatMetricValue } from '../lib/format';
import { useFocusTrap } from '../lib/useFocusTrap';
import { PriorityBadge, SeverityBadge, SlaBreachBadge, StatusBadge } from './Badges';
import { InsightPanel } from './InsightPanel';
import styles from './AlertDrawer.module.css';

/**
 * The detail panel: what happened, why it is ranked where it is, and the two things an operator
 * can actually do about it — change the status and record a note.
 *
 * It opens as a drawer rather than a page so the queue stays visible behind it. Working through
 * a list of incidents means constantly checking the next one against the current one, and a
 * full-page detail view forces a round trip through the list for every comparison.
 */

/** Verb for the button, rather than the name of the state it lands in. */
const TRANSITION_LABEL: Record<AlertStatus, string> = {
  new: 'Reset',
  acknowledged: 'Acknowledge',
  in_progress: 'Start work',
  resolved: 'Resolve',
  dismissed: 'Dismiss',
};

interface AlertDrawerProps {
  alertId: string;
  operator: string;
  onClose: () => void;
  onChanged: () => void;
  now: Date;
}

export function AlertDrawer({
  alertId,
  operator,
  onClose,
  onChanged,
  now,
}: AlertDrawerProps): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const [insight, setInsight] = useState<Insight | null>(null);
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);

  const detail = useResource<AlertDetailResponse>(
    (signal) => api.alert(alertId, signal),
    [alertId],
  );

  useFocusTrap(panelRef, true, onClose);

  // A different alert is a different conversation: nothing from the previous one carries over.
  useEffect(() => {
    setNoteDraft('');
    setActionError(null);
    setConflict(false);
    setInsightError(null);
    setInsight(null);
  }, [alertId]);

  useEffect(() => {
    if (detail.data !== null) setInsight(detail.data.insight);
  }, [detail.data]);

  const refreshAll = useCallback(() => {
    detail.refresh();
    onChanged();
  }, [detail, onChanged]);

  const handleFailure = useCallback((error: unknown) => {
    if (error instanceof ApiRequestError) {
      setActionError(error.message);
      setConflict(error.isConflict);
      return;
    }
    setActionError('Something went wrong. Please try again.');
  }, []);

  const changeStatus = useCallback(
    async (status: AlertStatus) => {
      if (detail.data === null || busy) return;
      setBusy(true);
      setActionError(null);
      try {
        const trimmed = noteDraft.trim();
        await api.patchAlert(alertId, {
          status,
          expectedVersion: detail.data.alert.version,
          actor: operator,
          ...(trimmed.length > 0 ? { note: trimmed } : {}),
        });
        setNoteDraft('');
        setConflict(false);
        refreshAll();
      } catch (error) {
        handleFailure(error);
      } finally {
        setBusy(false);
      }
    },
    [alertId, busy, detail.data, handleFailure, noteDraft, operator, refreshAll],
  );

  const addNote = useCallback(async () => {
    const trimmed = noteDraft.trim();
    if (trimmed.length === 0 || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.addNote(alertId, { body: trimmed, author: operator });
      setNoteDraft('');
      refreshAll();
    } catch (error) {
      handleFailure(error);
    } finally {
      setBusy(false);
    }
  }, [alertId, busy, handleFailure, noteDraft, operator, refreshAll]);

  const generateInsight = useCallback(
    async (refresh: boolean) => {
      if (insightBusy) return;
      setInsightBusy(true);
      setInsightError(null);
      try {
        const response = await api.insight(alertId, refresh);
        setInsight(response.insight);
        onChanged();
      } catch (error) {
        setInsightError(
          error instanceof ApiRequestError
            ? error.message
            : 'Could not generate an assessment right now.',
        );
      } finally {
        setInsightBusy(false);
      }
    },
    [alertId, insightBusy, onChanged],
  );

  const sendFeedback = useCallback(
    async (helpful: boolean) => {
      try {
        const response = await api.insightFeedback(alertId, { helpful, comment: null });
        setInsight(response.insight);
      } catch {
        // Feedback is a nicety; failing to record it must not interrupt the operator.
        setInsightError('Could not record that feedback.');
      }
    },
    [alertId],
  );

  const timeline = useMemo(
    () => buildTimeline(detail.data?.notes ?? [], detail.data?.events ?? []),
    [detail.data],
  );

  const alert = detail.data?.alert ?? null;
  const overLimit = noteDraft.length > NOTE_MAX_LENGTH;

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} aria-hidden="true" />
      <aside
        ref={panelRef}
        className={styles.drawer}
        role="dialog"
        aria-modal="true"
        aria-label={alert === null ? 'Alert detail' : alert.title}
      >
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <h2 className={styles.title}>{alert?.title ?? 'Loading…'}</h2>
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close detail panel">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
          {alert !== null && (
            <div className={styles.badges}>
              <PriorityBadge priority={alert.triage.priority} />
              <SeverityBadge severity={alert.severity} />
              <StatusBadge status={alert.status} />
              {alert.triage.slaBreached && <SlaBreachBadge target={`${alert.triage.slaAckMinutes}m`} />}
              <span className="mono" style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>
                {alert.id}
              </span>
            </div>
          )}
        </header>

        <div className={styles.body}>
          {detail.loading && <p className={styles.description}>Loading alert…</p>}

          {detail.error !== null && (
            <div className={styles.error}>
              <span>{detail.error.message}</span>
              <button type="button" className={`btn ${styles.errorAction}`} onClick={detail.refresh}>
                Retry
              </button>
            </div>
          )}

          {alert !== null && detail.data !== null && (
            <>
              <section className={styles.section}>
                <p className={styles.description}>{alert.description}</p>
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Details</h3>
                <div className={styles.facts}>
                  <Fact label="Site" value={alert.site.name} />
                  <Fact
                    label="Capacity"
                    value={formatCapacity(alert.site.capacityMw, alert.site.energyMwh)}
                  />
                  <Fact label="Equipment" value={alert.assetId ?? 'Site-wide'} mono />
                  <Fact label="Type" value={ALERT_TYPE_META[alert.type].label} />
                  <Fact label="Source" value={alert.source} mono />
                  <Fact label="Assignee" value={alert.assignee ?? 'Unassigned'} />
                  <Fact
                    label="Detected"
                    value={`${formatSiteTime(alert.detectedAt, alert.site.timezone)} (${alert.site.timezone.split('/').at(-1) ?? 'local'})`}
                  />
                  <Fact label="Open for" value={formatRelativeTime(alert.detectedAt, now)} />
                </div>
              </section>

              {Object.keys(alert.metrics).length > 0 && (
                <section className={styles.section}>
                  <h3 className={styles.sectionTitle}>Reported measurements</h3>
                  <div className={styles.metrics}>
                    {Object.entries(alert.metrics).map(([key, value]) => (
                      <div key={key} className={styles.metric}>
                        <span className={styles.metricLabel}>{humaniseKey(key)}</span>
                        <span className={styles.metricValue}>{formatMetricValue(value)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  Why this is ranked {alert.triage.priority}
                </h3>
                <ul className={styles.reasons}>
                  {alert.triage.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              </section>

              <section className={styles.section}>
                <InsightPanel
                  insight={insight}
                  generating={insightBusy}
                  error={insightError}
                  onGenerate={(refresh) => {
                    void generateInsight(refresh);
                  }}
                  onFeedback={(helpful) => {
                    void sendFeedback(helpful);
                  }}
                  now={now}
                />
              </section>

              <section className={styles.section}>
                <h3 className={styles.sectionTitle}>Activity</h3>
                <Timeline items={timeline} now={now} />
              </section>
            </>
          )}
        </div>

        {alert !== null && detail.data !== null && (
          <footer className={styles.footer}>
            {actionError !== null && (
              <div className={styles.error}>
                <span>{actionError}</span>
                {conflict && (
                  <button
                    type="button"
                    className={`btn ${styles.errorAction}`}
                    onClick={() => {
                      setActionError(null);
                      setConflict(false);
                      refreshAll();
                    }}
                  >
                    Reload
                  </button>
                )}
              </div>
            )}

            <div className={styles.composer}>
              <label htmlFor="note-body" className="visually-hidden">
                Follow-up note
              </label>
              <textarea
                id="note-body"
                className={styles.textarea}
                placeholder="Add a follow-up note — it will be attached to any status change you make below."
                value={noteDraft}
                maxLength={NOTE_MAX_LENGTH + 200}
                onChange={(event) => {
                  setNoteDraft(event.target.value);
                }}
              />
              <div className={styles.composerRow}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || noteDraft.trim().length === 0 || overLimit}
                  onClick={() => {
                    void addNote();
                  }}
                >
                  Add note
                </button>
                <span className={`${styles.counter} ${overLimit ? styles.overLimit : ''}`}>
                  {noteDraft.length}/{NOTE_MAX_LENGTH}
                </span>
              </div>
            </div>

            <div className={styles.actions}>
              {detail.data.allowedTransitions.map((status) => (
                <button
                  key={status}
                  type="button"
                  className={`btn ${status === 'resolved' ? 'btn-primary' : ''}`}
                  // Disabled while a request is in flight, so a double click cannot fire two
                  // writes; the version guard would reject the second anyway, but showing a
                  // conflict the operator did not cause would be its own bug.
                  disabled={busy || overLimit}
                  onClick={() => {
                    void changeStatus(status);
                  }}
                >
                  {status === 'in_progress' &&
                  (alert.status === 'resolved' || alert.status === 'dismissed')
                    ? 'Reopen'
                    : TRANSITION_LABEL[status]}
                </button>
              ))}
            </div>
          </footer>
        )}
      </aside>
    </>
  );
}

function Fact({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): React.JSX.Element {
  return (
    <div className={styles.fact}>
      <span className={styles.factLabel}>{label}</span>
      <span className={`${styles.factValue} ${mono === true ? 'mono' : ''}`}>{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ timeline */

interface TimelineItem {
  key: string;
  createdAt: string;
  actor: string;
  text: string;
  glyph: string;
  isNote: boolean;
}

function describeEvent(event: AlertEvent): string {
  switch (event.kind) {
    case 'alert_created':
      return 'Alert raised by monitoring';
    case 'status_changed':
      return `Status changed from ${event.fromStatus === null ? '—' : STATUS_LABEL[event.fromStatus]} to ${
        event.toStatus === null ? '—' : STATUS_LABEL[event.toStatus]
      }`;
    case 'assignee_changed':
      return event.detail ?? 'Assignee changed';
    case 'insight_generated':
      return `AI assessment generated — ${event.detail ?? 'unknown source'}`;
    case 'insight_feedback':
      return event.detail ?? 'Feedback recorded on the AI assessment';
    case 'note_added':
      return event.detail ?? 'Note added';
  }
}

const EVENT_GLYPH: Record<AlertEvent['kind'], string> = {
  alert_created: '◎',
  status_changed: '⇄',
  assignee_changed: '☺',
  note_added: '✎',
  insight_generated: '✦',
  insight_feedback: '☑',
};

export function buildTimeline(notes: AlertNote[], events: AlertEvent[]): TimelineItem[] {
  const items: TimelineItem[] = [
    // `note_added` events are dropped: the note itself is rendered with its full text, and
    // showing both would say the same thing twice on consecutive lines.
    ...events
      .filter((event) => event.kind !== 'note_added')
      .map((event) => ({
        key: `event-${event.id}`,
        createdAt: event.createdAt,
        actor: event.actor,
        text: describeEvent(event),
        glyph: EVENT_GLYPH[event.kind],
        isNote: false,
      })),
    ...notes.map((note) => ({
      key: `note-${note.id}`,
      createdAt: note.createdAt,
      actor: note.author,
      text: note.body,
      glyph: '✎',
      isNote: true,
    })),
  ];

  return items.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

function Timeline({ items, now }: { items: TimelineItem[]; now: Date }): React.JSX.Element {
  if (items.length === 0) {
    return <p className={styles.description}>Nothing has happened on this alert yet.</p>;
  }

  return (
    <ol className={styles.timeline}>
      {items.map((item) => (
        <li key={item.key} className={styles.entry}>
          <span className={styles.entryMarker} aria-hidden="true">
            {item.glyph}
          </span>
          <div className={styles.entryBody}>
            <div className={styles.entryHead}>
              <span className={styles.entryAuthor}>{item.actor}</span>
              <span>{formatRelativeTime(item.createdAt, now)}</span>
            </div>
            <div className={`${styles.entryText} ${item.isNote ? styles.noteEntry : ''}`}>
              {item.text}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
