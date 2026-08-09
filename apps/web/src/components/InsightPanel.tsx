import { useState } from 'react';
import {
  ACTION_OWNER_LABEL,
  ACTION_URGENCY_LABEL,
  type Insight,
} from '@incident-board/shared';
import { formatRelativeTime } from '../lib/format';
import { PriorityBadge } from './Badges';
import styles from './InsightPanel.module.css';

/**
 * The AI-assisted assessment.
 *
 * Three things are deliberately never hidden from the operator:
 *
 *  1. **Where the answer came from** — provider, model and generation time sit in the header,
 *     so nobody has to wonder whether they are reading the model or the fallback.
 *  2. **Where the checks disagreed** — when the model's priority differs from the deterministic
 *     rules by two bands or more, both verdicts are shown side by side. Picking one silently
 *     would be presenting a coin toss as an answer.
 *  3. **What the checks flagged** — ungrounded figures, suspected prompt injection, a repaired
 *     response. Warnings appear next to the text they qualify, not in a log nobody reads.
 *
 * Nothing here writes to the alert. Every action stays with the human.
 */

interface InsightPanelProps {
  insight: Insight | null;
  generating: boolean;
  error: string | null;
  onGenerate: (refresh: boolean) => void;
  onFeedback: (helpful: boolean) => void;
  now: Date;
}

export function InsightPanel({
  insight,
  generating,
  error,
  onGenerate,
  onFeedback,
  now,
}: InsightPanelProps): React.JSX.Element {
  const [feedbackSent, setFeedbackSent] = useState(false);

  if (insight === null) {
    return (
      <div className={styles.panel}>
        <div className={styles.head}>
          <span className={styles.headTitle}>
            <span aria-hidden="true">✦</span> AI assessment
          </span>
        </div>
        <div className={styles.empty}>
          {generating ? (
            <Generating />
          ) : (
            <>
              <p className={styles.emptyText}>
                Summarise this alert, suggest a priority and propose next actions. The answer is
                advisory — it never changes the alert, and it is cross-checked against the
                scoring rules before you see it.
              </p>
              {error !== null && <p className={styles.warning + ' ' + styles.warningLevel}>{error}</p>}
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onGenerate(false);
                }}
              >
                Generate assessment
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const { payload, ruleBaseline, disagreement } = insight;

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <span className={styles.headTitle}>
          <span aria-hidden="true">✦</span> AI assessment
        </span>
        <span className={styles.provenance}>
          {insight.degraded ? 'rules engine' : insight.model} ·{' '}
          {formatRelativeTime(insight.generatedAt, now)} · {insight.latencyMs}ms
        </span>
        <span className={styles.headActions}>
          <button
            type="button"
            className="btn"
            disabled={generating}
            onClick={() => {
              setFeedbackSent(false);
              onGenerate(true);
            }}
          >
            {generating ? 'Working…' : 'Regenerate'}
          </button>
        </span>
      </div>

      <div className={styles.content}>
        {generating && <Generating />}

        {insight.degraded && (
          <div className={styles.degradedBanner}>
            <strong>Produced by the deterministic rules engine, not the language model.</strong>
            <span>
              {insight.degradedReason ?? 'The model was unavailable.'} This is the standard
              playbook for this alert type and has not been tailored to the details of this
              incident.
            </span>
          </div>
        )}

        <p className={styles.summary}>{payload.summary}</p>

        <div className={styles.verdicts}>
          <span className={styles.verdict}>
            <span className={styles.verdictLabel}>
              {insight.degraded ? 'Rules' : 'Model'} suggests
            </span>
            <PriorityBadge priority={payload.suggestedPriority} />
          </span>
          {!insight.degraded && (
            <span className={styles.verdict}>
              <span className={styles.verdictLabel}>Scoring rules give</span>
              <PriorityBadge priority={ruleBaseline.priority} />
            </span>
          )}
          {disagreement.level === 'major' && (
            <span className={styles.disagreement}>
              These disagree by {disagreement.bands} bands — decide for yourself.
            </span>
          )}
          <span className={styles.verdictLabel}>Confidence: {payload.confidence}</span>
        </div>

        <div className={styles.block}>
          <span className={styles.blockLabel}>Why this priority</span>
          <p className={styles.emptyText}>{payload.priorityRationale}</p>
        </div>

        <div className={styles.block}>
          <span className={styles.blockLabel}>Likely causes</span>
          <ul className={styles.causes}>
            {payload.likelyCauses.map((cause) => (
              <li key={cause}>{cause}</li>
            ))}
          </ul>
        </div>

        <div className={styles.block}>
          <span className={styles.blockLabel}>Suggested next actions</span>
          <ul className={styles.actions}>
            {payload.nextActions.map((action) => (
              <li key={action.action} className={styles.action}>
                <span className={styles.actionText}>{action.action}</span>
                <span className={styles.actionMeta}>
                  <span className={`${styles.urgency} ${styles[action.urgency]}`}>
                    {ACTION_URGENCY_LABEL[action.urgency]}
                  </span>
                  <span className={styles.owner}>{ACTION_OWNER_LABEL[action.owner]}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        {insight.warnings.length > 0 && (
          <div className={styles.warnings}>
            {insight.warnings.map((warning) => (
              <div
                key={warning.code}
                className={`${styles.warning} ${
                  warning.severity === 'warning' ? styles.warningLevel : styles.infoLevel
                }`}
              >
                <span aria-hidden="true">{warning.severity === 'warning' ? '⚠' : 'ⓘ'}</span>
                <span>{warning.message}</span>
              </div>
            ))}
          </div>
        )}

        <div className={styles.feedback}>
          <span>
            {insight.feedback !== null
              ? `Marked ${insight.feedback.helpful ? 'helpful' : 'not helpful'}`
              : feedbackSent
                ? 'Thanks — recorded.'
                : 'Was this useful?'}
          </span>
          <span className={styles.feedbackButtons}>
            <button
              type="button"
              className="btn"
              aria-pressed={insight.feedback?.helpful === true}
              onClick={() => {
                setFeedbackSent(true);
                onFeedback(true);
              }}
            >
              <span aria-hidden="true">👍</span> Helpful
            </button>
            <button
              type="button"
              className="btn"
              aria-pressed={insight.feedback?.helpful === false}
              onClick={() => {
                setFeedbackSent(true);
                onFeedback(false);
              }}
            >
              <span aria-hidden="true">👎</span> Not helpful
            </button>
          </span>
        </div>

        <p className={styles.disclaimer}>
          Generated text can be wrong. Check any figure against the measurements above before
          acting on it, and treat the actions as a prompt for judgement rather than instructions.
        </p>
      </div>
    </div>
  );
}

function Generating(): React.JSX.Element {
  return (
    <div className={styles.generating} role="status" aria-live="polite">
      <span className={styles.spinner} aria-hidden="true" />
      {/* On CPU a 3B model takes real seconds. Saying so is better than a spinner that looks
          like it has hung. */}
      <span>Running the local model — this can take up to a minute on CPU…</span>
    </div>
  );
}
