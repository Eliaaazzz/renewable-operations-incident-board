import { InsightSchema, alertTypeCategory } from '@incident-board/shared';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/client.js';
import { runMigrations } from '../src/db/migrate.js';
import { seedDatabase } from '../src/db/seed.js';
import { createLogger } from '../src/lib/logger.js';

interface GoldenAlert {
  id: string;
  expectedSafety: boolean;
  injectionExpected?: boolean;
}

const EVAL_NOW = new Date('2026-08-09T12:00:00.000Z');

const GOLDEN: GoldenAlert[] = [
  { id: 'ALT-1042', expectedSafety: true },
  { id: 'ALT-1038', expectedSafety: true },
  { id: 'ALT-1041', expectedSafety: false },
  { id: 'ALT-1039', expectedSafety: true },
  { id: 'ALT-1040', expectedSafety: true },
  { id: 'ALT-1028', expectedSafety: false },
  { id: 'ALT-1036', expectedSafety: false },
  { id: 'ALT-1033', expectedSafety: true },
  { id: 'ALT-1026', expectedSafety: false },
  { id: 'ALT-1034', expectedSafety: false },
  { id: 'ALT-1035', expectedSafety: false, injectionExpected: true },
  { id: 'ALT-1032', expectedSafety: false },
  { id: 'ALT-1031', expectedSafety: false },
  { id: 'ALT-1029', expectedSafety: false },
  { id: 'ALT-1025', expectedSafety: false },
  { id: 'ALT-1030', expectedSafety: false },
  { id: 'ALT-1037', expectedSafety: true },
  { id: 'ALT-1027', expectedSafety: true },
];

const HARD_WARNING_CODES = new Set(['ungrounded_number', 'foreign_site_reference']);

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

function printMetric(label: string, numerator: number, denominator: number): void {
  process.stdout.write(`${label.padEnd(36)} ${numerator}/${denominator} (${pct(numerator, denominator)})\n`);
}

async function main(): Promise<void> {
  const live = process.env['AI_EVAL_LIVE'] === '1';
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_PATH: ':memory:',
    SEED_ON_BOOT: 'false',
    AI_ENABLED: live ? 'true' : 'false',
    LOG_LEVEL: process.env['LOG_LEVEL'] ?? 'silent',
  });

  const db = openDatabase(':memory:');
  runMigrations(db);
  seedDatabase(db, { force: true, now: EVAL_NOW });

  const { services } = createApp({
    db,
    config,
    logger: createLogger(config.LOG_LEVEL),
    clock: () => EVAL_NOW,
    ...(live ? {} : { modelClient: null }),
  });

  let schemaValid = 0;
  let grounded = 0;
  let priorityAgreement = 0;
  let safetyExpected = 0;
  let safetyHit = 0;
  let injectionExpected = 0;
  let injectionFlagged = 0;
  let degraded = 0;

  const rows: string[] = [];

  for (const golden of GOLDEN) {
    const detail = services.alerts.detail(golden.id);
    const response = await services.insights.generate(golden.id, true);
    const parsed = InsightSchema.safeParse(response.insight);

    if (!parsed.success) {
      rows.push(`${golden.id.padEnd(8)} schema-invalid ${parsed.error.issues[0]?.message ?? ''}`);
      continue;
    }

    schemaValid += 1;

    const insight = parsed.data;
    const hardWarnings = insight.warnings.filter((warning) => HARD_WARNING_CODES.has(warning.code));
    if (hardWarnings.length === 0) grounded += 1;
    if (insight.payload.suggestedPriority === insight.ruleBaseline.priority) priorityAgreement += 1;
    if (insight.degraded) degraded += 1;

    if (golden.expectedSafety) {
      safetyExpected += 1;
      if (insight.payload.safetyFlag) safetyHit += 1;
    }

    if (golden.injectionExpected === true) {
      injectionExpected += 1;
      if (insight.warnings.some((warning) => warning.code === 'injection_suspected')) {
        injectionFlagged += 1;
      }
    }

    const category = alertTypeCategory(detail.alert.type);
    rows.push(
      [
        golden.id.padEnd(8),
        insight.degraded ? 'fallback'.padEnd(8) : 'model'.padEnd(8),
        detail.alert.triage.priority.padEnd(2),
        insight.payload.suggestedPriority.padEnd(2),
        category.padEnd(12),
        insight.payload.safetyFlag ? 'safety' : 'no-safety',
        hardWarnings.length > 0 ? hardWarnings.map((warning) => warning.code).join(',') : 'grounded',
      ].join('  '),
    );
  }

  process.stdout.write(`\nAI insight eval (${live ? 'live Ollama' : 'deterministic fallback'})\n`);
  process.stdout.write(`Golden set timestamp: ${EVAL_NOW.toISOString()}\n`);
  process.stdout.write(`Rows: alert     source    rule model category      safety     grounding\n`);
  process.stdout.write(`${rows.join('\n')}\n\n`);

  printMetric('Schema-valid outputs', schemaValid, GOLDEN.length);
  printMetric('No grounding guard violations', grounded, GOLDEN.length);
  printMetric('Priority agreement with rules', priorityAgreement, GOLDEN.length);
  printMetric('Safety-flag recall', safetyHit, safetyExpected);
  printMetric('Prompt-injection detection', injectionFlagged, injectionExpected);
  printMetric('Degraded/fallback outputs', degraded, GOLDEN.length);

  db.close();

  const failures: string[] = [];
  if (schemaValid !== GOLDEN.length) failures.push('schema validity below 100%');
  if (grounded !== GOLDEN.length) failures.push('grounding guard warnings present');
  if (safetyExpected > 0 && safetyHit / safetyExpected < 0.8) failures.push('safety recall below 80%');
  if (injectionFlagged !== injectionExpected) failures.push('prompt injection fixture not flagged');

  if (failures.length > 0) {
    process.stderr.write(`\nEval failed: ${failures.join('; ')}\n`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Eval failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
