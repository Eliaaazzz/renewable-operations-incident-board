import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { InsightResponseSchema } from '@incident-board/shared';
import {
  createStubModelClient,
  createTestApp,
  modelAnswer,
  type StubModelClient,
  type TestApp,
} from '../testing/test-app.js';

/**
 * The AI feature's contract with the operator.
 *
 * The single most important property asserted here is that **the endpoint never fails because
 * the model failed**. Every way a local model can let you down — absent, unreachable, slow,
 * verbose, malformed, confidently wrong about which site it is looking at — has to end in a
 * usable 200 with an honest label on it.
 */

const CRITICAL_ALERT = 'ALT-1042'; // Kestrel Flats BESS, thermal runaway risk

let harness: TestApp | undefined;

afterEach(() => {
  harness?.db.close();
  harness = undefined;
});

function setup(modelClient?: StubModelClient): TestApp {
  harness = createTestApp(modelClient === undefined ? {} : { modelClient });
  return harness;
}

describe('POST /api/alerts/:id/insight — when no model is available', () => {
  it('degrades to the deterministic engine instead of failing', async () => {
    const { app } = setup();
    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.degraded).toBe(true);
    expect(insight.provider).toBe('rule-based');
    expect(insight.payload.nextActions.length).toBeGreaterThan(0);
    expect(insight.payload.safetyFlag).toBe(true);
    expect(insight.warnings.map((warning) => warning.code)).toContain('provider_unavailable');
  });

  it('says plainly in the warning that this is not the model talking', async () => {
    const { app } = setup();
    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);
    const warning = insight.warnings.find((entry) => entry.code === 'provider_unavailable');
    expect(warning?.message).toMatch(/deterministic|rules engine/i);
  });

  it('does not serve a degraded answer from cache once the model is back', async () => {
    // A fallback is a statement about the world at one moment, not about the alert. Caching it
    // would pin the alert to the playbook answer forever.
    const { app } = setup();
    const first = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const second = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);

    expect(InsightResponseSchema.parse(first.body).cached).toBe(false);
    expect(InsightResponseSchema.parse(second.body).cached).toBe(false);
  });

  it.each([
    ['an unreachable daemon', new Error('fetch failed')],
    ['a timeout', Object.assign(new Error('aborted'), { name: 'AbortError' })],
  ])('survives %s', async (_label, failure) => {
    const { app } = setup(createStubModelClient({ failWith: failure }));
    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.degraded).toBe(true);
    expect(insight.degradedReason).toBeTruthy();
  });
});

describe('POST /api/alerts/:id/insight — with a working model', () => {
  it('returns the model answer and caches it', async () => {
    const stub = createStubModelClient({ responses: [modelAnswer()] });
    const { app } = setup(stub);

    const first = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const second = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);

    const firstInsight = InsightResponseSchema.parse(first.body);
    expect(firstInsight.insight.degraded).toBe(false);
    expect(firstInsight.insight.provider).toBe('ollama');
    expect(firstInsight.cached).toBe(false);

    expect(InsightResponseSchema.parse(second.body).cached).toBe(true);
    // The expensive part must have happened exactly once.
    expect(stub.calls).toHaveLength(1);
  });

  it('regenerates when asked to refresh', async () => {
    const stub = createStubModelClient({ responses: [modelAnswer()] });
    const { app } = setup(stub);

    await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { body } = await request(app)
      .post(`/api/alerts/${CRITICAL_ALERT}/insight?refresh=true`)
      .expect(200);

    expect(InsightResponseSchema.parse(body).cached).toBe(false);
    expect(stub.calls).toHaveLength(2);
  });

  it('invalidates the cache when the alert gains a note', async () => {
    // The cached answer describes a state that no longer exists. Serving it would let the
    // assistant contradict the timeline directly above it.
    const stub = createStubModelClient({ responses: [modelAnswer()] });
    const { app } = setup(stub);

    await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    await request(app)
      .post(`/api/alerts/${CRITICAL_ALERT}/notes`)
      .send({ body: 'Rack isolated manually at 12:05.' })
      .expect(201);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    expect(InsightResponseSchema.parse(body).cached).toBe(false);
    expect(stub.calls).toHaveLength(2);
  });

  it('collapses concurrent requests into a single generation', async () => {
    // Local inference is serialised by the GPU; a double-click must not cost two runs.
    const stub = createStubModelClient({ responses: [modelAnswer()], delayMs: 40 });
    const { app } = setup(stub);

    const [first, second] = await Promise.all([
      request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`),
      request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(stub.calls).toHaveLength(1);
  });

  it('repairs a malformed first response rather than giving up on it', async () => {
    const stub = createStubModelClient({
      responses: ['Sure! Here is the assessment: {"summary": "oops", "confidence": "very"}', modelAnswer()],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.degraded).toBe(false);
    expect(insight.warnings.map((warning) => warning.code)).toContain('schema_repair');
    expect(stub.calls).toEqual([{ repair: false }, { repair: true }]);
  });

  it('recovers a valid object wrapped in prose and code fences', async () => {
    const stub = createStubModelClient({
      responses: ['Here you go:\n```json\n' + modelAnswer() + '\n```\nHope that helps!'],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    expect(InsightResponseSchema.parse(body).insight.degraded).toBe(false);
  });

  it('falls back when even the repair attempt fails', async () => {
    const stub = createStubModelClient({ responses: ['not json at all', 'still not json'] });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.degraded).toBe(true);
    expect(insight.provider).toBe('rule-based');
    expect(stub.calls).toHaveLength(2);
  });
});

describe('guardrails', () => {
  it('flags a figure that does not appear in the alert record', async () => {
    const stub = createStubModelClient({
      responses: [
        modelAnswer({
          summary: 'Cell temperature has reached 999.7 °C and the rack is venting continuously.',
        }),
      ],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.warnings.map((warning) => warning.code)).toContain('ungrounded_number');
    // Advisory, not fatal: the operator still gets the answer, with the caveat attached.
    expect(insight.degraded).toBe(false);
    expect(insight.payload.confidence).toBe('low');
  });

  it('does not flag figures that are in the record', async () => {
    const stub = createStubModelClient({
      responses: [
        modelAnswer({
          summary: 'Cell temperature is 61.8 °C against a 55 °C threshold in rack R04.',
        }),
      ],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);
    expect(insight.warnings.map((warning) => warning.code)).not.toContain('ungrounded_number');
  });

  it('discards an answer that talks about a different site', async () => {
    // Confusing two assets is not a caveat, it is a wrong answer: the causes and the actions
    // belong to another plant.
    const stub = createStubModelClient({
      responses: [
        modelAnswer({
          summary: 'Inverter INV-07 at Mojave Ridge Solar has stopped exporting.',
        }),
      ],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.degraded).toBe(true);
    expect(insight.degradedReason).toMatch(/unrelated site/i);
    expect(insight.provider).toBe('rule-based');
  });

  it('surfaces both verdicts when the model disagrees with the rules', async () => {
    const stub = createStubModelClient({
      responses: [modelAnswer({ suggestedPriority: 'P4' })],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.payload.suggestedPriority).toBe('P4');
    expect(insight.ruleBaseline.priority).toBe('P1');
    expect(insight.disagreement.level).toBe('major');
    expect(insight.warnings.map((warning) => warning.code)).toContain('priority_disagreement');
  });

  it('reports agreement when the two verdicts match', async () => {
    const stub = createStubModelClient({ responses: [modelAnswer({ suggestedPriority: 'P1' })] });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);
    expect(insight.disagreement).toEqual({ bands: 0, level: 'none' });
  });

  it('flags an alert carrying an embedded instruction', async () => {
    // ALT-1035's description contains a vendor string telling the model to ignore its
    // instructions. The alert content is passed as data, and the operator is told about it.
    const stub = createStubModelClient({
      responses: [
        modelAnswer({
          summary: 'Telemetry from the site logger has stopped arriving.',
          suggestedPriority: 'P3',
          safetyFlag: false,
        }),
      ],
    });
    const { app } = setup(stub);

    const { body } = await request(app).post('/api/alerts/ALT-1035/insight').expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.warnings.map((warning) => warning.code)).toContain('injection_suspected');
  });

  it('always records provenance so an answer can be traced back', async () => {
    const stub = createStubModelClient({ responses: [modelAnswer()] });
    const { app } = setup(stub);

    const { body } = await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);
    const { insight } = InsightResponseSchema.parse(body);

    expect(insight.model).toBe('stub-model');
    expect(insight.promptHash).toHaveLength(16);
    expect(insight.contentHash).toHaveLength(16);
    expect(insight.generatedAt).toBe(harness?.now.toISOString());
  });

  it('records generation on the audit trail', async () => {
    const { app } = setup(createStubModelClient({ responses: [modelAnswer()] }));
    await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);

    const { body } = await request(app).get(`/api/alerts/${CRITICAL_ALERT}`).expect(200);
    expect(body.events.map((event: { kind: string }) => event.kind)).toContain('insight_generated');
  });
});

describe('insight feedback', () => {
  it('stores an operator verdict against the latest insight', async () => {
    const { app } = setup(createStubModelClient({ responses: [modelAnswer()] }));
    await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);

    const { body } = await request(app)
      .post(`/api/alerts/${CRITICAL_ALERT}/insight/feedback`)
      .send({ helpful: false, comment: 'Missed that the rack had already isolated.' })
      .expect(200);

    expect(body.insight.feedback).toMatchObject({
      helpful: false,
      comment: 'Missed that the rack had already isolated.',
    });
  });

  it('replaces an earlier verdict rather than accumulating duplicates', async () => {
    const { app } = setup(createStubModelClient({ responses: [modelAnswer()] }));
    await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight`).expect(200);

    await request(app)
      .post(`/api/alerts/${CRITICAL_ALERT}/insight/feedback`)
      .send({ helpful: false })
      .expect(200);
    const { body } = await request(app)
      .post(`/api/alerts/${CRITICAL_ALERT}/insight/feedback`)
      .send({ helpful: true })
      .expect(200);

    expect(body.insight.feedback.helpful).toBe(true);
  });

  it('404s when no insight has been generated yet', async () => {
    const { app } = setup();
    const { body } = await request(app)
      .post('/api/alerts/ALT-1041/insight/feedback')
      .send({ helpful: true })
      .expect(404);
    expect(body.error.code).toBe('not_found');
  });

  it('rejects a body without a verdict', async () => {
    const { app } = setup();
    await request(app).post(`/api/alerts/${CRITICAL_ALERT}/insight/feedback`).send({}).expect(400);
  });
});

describe('insight for unknown alerts', () => {
  it('404s rather than generating an answer about nothing', async () => {
    const { app } = setup(createStubModelClient({ responses: [modelAnswer()] }));
    await request(app).post('/api/alerts/ALT-0000/insight').expect(404);
  });
});
