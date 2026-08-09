import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AlertDetailResponseSchema, AlertListResponseSchema } from '@incident-board/shared';
import { createTestApp, type TestApp } from '../testing/test-app.js';

/**
 * API behaviour that matters most: that the list can be filtered and paged without lying,
 * that a status change is safe under concurrency, and that every rejection is a specific,
 * actionable status code rather than a 500.
 *
 * Responses are parsed with the *shared* response schemas, so these tests also assert that the
 * API keeps the contract the web client compiles against.
 */

let harness: TestApp;

beforeEach(() => {
  harness = createTestApp();
});

afterEach(() => {
  harness.db.close();
});

const api = () => request(harness.app);

describe('GET /api/alerts', () => {
  it('returns the whole board and matches the published contract', async () => {
    const response = await api().get('/api/alerts').expect(200);
    const body = AlertListResponseSchema.parse(response.body);

    expect(body.total).toBe(18);
    expect(body.items).toHaveLength(18);
    expect(body.page).toBe(1);
    expect(body.totalPages).toBe(1);
  });

  it('ranks by triage score by default, not by severity alone', async () => {
    const { body } = await api().get('/api/alerts').expect(200);
    const parsed = AlertListResponseSchema.parse(body);
    const scores = parsed.items.map((item) => item.triage.score);

    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(parsed.items[0]?.triage.priority).toBe('P1');
    // Closed alerts carry no live urgency and must sink, whatever their severity was.
    expect(parsed.items.at(-1)?.triage.score).toBe(0);
  });

  it.each([
    ['repeated params', '/api/alerts?status=new&status=acknowledged'],
    ['comma-separated', '/api/alerts?status=new,acknowledged'],
  ])('accepts multi-value filters as %s', async (_label, url) => {
    const { body } = await api().get(url).expect(200);
    const parsed = AlertListResponseSchema.parse(body);

    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items.every((item) => ['new', 'acknowledged'].includes(item.status))).toBe(true);
  });

  it('filters to what needs attention', async () => {
    const { body } = await api().get('/api/alerts?needsAttention=true').expect(200);
    const parsed = AlertListResponseSchema.parse(body);

    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items.every((item) => item.triage.needsAttention)).toBe(true);
  });

  it('searches across title, asset and site name', async () => {
    const byAsset = await api().get('/api/alerts?q=INV-07').expect(200);
    expect(AlertListResponseSchema.parse(byAsset.body).items[0]?.id).toBe('ALT-1041');

    const bySite = await api().get('/api/alerts?q=talbot').expect(200);
    const parsed = AlertListResponseSchema.parse(bySite.body);
    expect(parsed.items.length).toBeGreaterThan(0);
    expect(parsed.items.every((item) => item.site.name.includes('Talbot'))).toBe(true);
  });

  it('reports zero results as an empty page, not an error', async () => {
    const { body } = await api().get('/api/alerts?q=no-such-thing-exists').expect(200);
    const parsed = AlertListResponseSchema.parse(body);
    expect(parsed.items).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('counts facets with that dimension excluded, so a chip can show what selecting it would give', async () => {
    const { body } = await api().get('/api/alerts?status=new').expect(200);
    const parsed = AlertListResponseSchema.parse(body);

    // The list is narrowed to `new`...
    expect(parsed.items.every((item) => item.status === 'new')).toBe(true);
    // ...but the status facet still knows what the other statuses hold.
    expect(parsed.facets.status.resolved).toBeGreaterThan(0);
    expect(parsed.facets.status.new).toBe(parsed.total);
  });

  it('constrains other facets by the active filters', async () => {
    const { body } = await api().get('/api/alerts?severity=critical').expect(200);
    const parsed = AlertListResponseSchema.parse(body);
    const statusTotal = Object.values(parsed.facets.status).reduce((sum, n) => sum + n, 0);
    expect(statusTotal).toBe(parsed.total);
  });

  describe('paging', () => {
    it('slices deterministically and reports the page count', async () => {
      const first = await api().get('/api/alerts?pageSize=5&page=1').expect(200);
      const second = await api().get('/api/alerts?pageSize=5&page=2').expect(200);
      const firstPage = AlertListResponseSchema.parse(first.body);
      const secondPage = AlertListResponseSchema.parse(second.body);

      expect(firstPage.items).toHaveLength(5);
      expect(firstPage.totalPages).toBe(4);
      // No row may appear on two pages, or pagination is silently losing alerts.
      const overlap = firstPage.items.filter((item) =>
        secondPage.items.some((other) => other.id === item.id),
      );
      expect(overlap).toEqual([]);
    });

    it('clamps an oversized page size instead of rejecting it', async () => {
      const { body } = await api().get('/api/alerts?pageSize=100000').expect(200);
      expect(AlertListResponseSchema.parse(body).pageSize).toBe(100);
    });

    it('returns an empty page past the end rather than a 404', async () => {
      const { body } = await api().get('/api/alerts?page=99').expect(200);
      const parsed = AlertListResponseSchema.parse(body);
      expect(parsed.items).toEqual([]);
      expect(parsed.total).toBe(18);
    });

    it.each([
      ['page=0', '/api/alerts?page=0'],
      ['negative page size', '/api/alerts?pageSize=-5'],
      ['non-numeric page', '/api/alerts?page=abc'],
      ['unknown status', '/api/alerts?status=exploded'],
      ['unknown sort field', '/api/alerts?sort=vibes'],
      ['malformed date', '/api/alerts?from=yesterday'],
    ])('rejects %s with a field-level 400', async (_label, url) => {
      const { body } = await api().get(url).expect(400);
      expect(body.error.code).toBe('bad_request');
      expect(body.error.requestId).toBeTruthy();
      expect(Array.isArray(body.error.details.issues)).toBe(true);
    });
  });

  it('treats SQL-shaped input as an ordinary search string', async () => {
    const { body } = await api()
      .get(`/api/alerts?q=${encodeURIComponent("'; DROP TABLE alerts; --")}`)
      .expect(200);
    expect(AlertListResponseSchema.parse(body).items).toEqual([]);
    // The table is still there.
    await api().get('/api/alerts').expect(200);
  });
});

describe('GET /api/alerts/:id', () => {
  it('returns the alert with its timeline and the legal next statuses', async () => {
    const { body } = await api().get('/api/alerts/ALT-1039').expect(200);
    const detail = AlertDetailResponseSchema.parse(body);

    expect(detail.alert.id).toBe('ALT-1039');
    expect(detail.notes.length).toBeGreaterThanOrEqual(4);
    expect(detail.events.length).toBeGreaterThan(0);
    expect(detail.allowedTransitions).toContain('resolved');
    expect(detail.allowedTransitions).not.toContain('new');
  });

  it('404s an unknown id', async () => {
    const { body } = await api().get('/api/alerts/ALT-9999').expect(404);
    expect(body.error.code).toBe('not_found');
  });
});

describe('PATCH /api/alerts/:id', () => {
  it('acknowledges an alert, stamps the time and records an audit event', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-1041')
      .send({ status: 'acknowledged', expectedVersion: 0, actor: 'A. Tester' })
      .expect(200);

    const detail = AlertDetailResponseSchema.parse(body);
    expect(detail.alert.status).toBe('acknowledged');
    expect(detail.alert.version).toBe(1);
    expect(detail.alert.acknowledgedAt).not.toBeNull();

    const event = detail.events.at(-1);
    expect(event?.kind).toBe('status_changed');
    expect(event?.fromStatus).toBe('new');
    expect(event?.toStatus).toBe('acknowledged');
    expect(event?.actor).toBe('A. Tester');
  });

  it('treats starting work as implicit acknowledgement', async () => {
    // Otherwise an alert somebody picked up instantly would be recorded as never acknowledged
    // and would report an SLA breach it never had.
    const { body } = await api()
      .patch('/api/alerts/ALT-1041')
      .send({ status: 'in_progress', expectedVersion: 0 })
      .expect(200);

    expect(AlertDetailResponseSchema.parse(body).alert.acknowledgedAt).not.toBeNull();
  });

  it('clears the resolution time when an alert is reopened', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-1037')
      .send({ status: 'in_progress', expectedVersion: 0 })
      .expect(200);

    const detail = AlertDetailResponseSchema.parse(body);
    expect(detail.alert.status).toBe('in_progress');
    expect(detail.alert.resolvedAt).toBeNull();
  });

  it('rejects an illegal transition with the legal alternatives', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-1037')
      .send({ status: 'new', expectedVersion: 0 })
      .expect(422);

    expect(body.error.code).toBe('invalid_transition');
    expect(body.error.details).toMatchObject({ from: 'resolved', to: 'new' });
    expect(body.error.details.allowed).toEqual(['in_progress']);
  });

  it('rejects a no-op transition with a message that says so', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-1041')
      .send({ status: 'new', expectedVersion: 0 })
      .expect(422);

    expect(body.error.message).toMatch(/already/i);
  });

  it('rejects a stale write and reports the current version', async () => {
    // Two operators both loaded version 0. The first write wins; the second must not silently
    // overwrite it.
    await api()
      .patch('/api/alerts/ALT-1041')
      .send({ status: 'acknowledged', expectedVersion: 0 })
      .expect(200);

    const { body } = await api()
      .patch('/api/alerts/ALT-1041')
      .send({ status: 'in_progress', expectedVersion: 0 })
      .expect(409);

    expect(body.error.code).toBe('conflict');
    expect(body.error.details).toMatchObject({ expectedVersion: 0, currentVersion: 1 });

    const after = await api().get('/api/alerts/ALT-1041').expect(200);
    expect(AlertDetailResponseSchema.parse(after.body).alert.status).toBe('acknowledged');
  });

  it('records the reason alongside the change when a note is supplied', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-1041')
      .send({
        status: 'dismissed',
        expectedVersion: 0,
        actor: 'A. Tester',
        note: 'Duplicate of ALT-1032 — closing.',
      })
      .expect(200);

    const detail = AlertDetailResponseSchema.parse(body);
    expect(detail.notes.at(-1)?.body).toBe('Duplicate of ALT-1032 — closing.');
    expect(detail.events.map((event) => event.kind)).toContain('note_added');
  });

  it.each([
    ['no expectedVersion', { status: 'acknowledged' }],
    ['neither status nor assignee', { expectedVersion: 0 }],
    ['unknown status', { status: 'exploded', expectedVersion: 0 }],
    ['blank assignee', { assignee: '   ', expectedVersion: 0 }],
  ])('rejects a body with %s', async (_label, payload) => {
    const { body } = await api().patch('/api/alerts/ALT-1041').send(payload).expect(400);
    expect(body.error.code).toBe('bad_request');
  });

  it('404s before validating concurrency on an unknown alert', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-0000')
      .send({ status: 'acknowledged', expectedVersion: 0 })
      .expect(404);
    expect(body.error.code).toBe('not_found');
  });
});

describe('POST /api/alerts/:id/notes', () => {
  it('adds a note and shows it on the timeline', async () => {
    const { body } = await api()
      .post('/api/alerts/ALT-1042/notes')
      .send({ body: 'Site lead called, field team en route.', author: 'A. Tester' })
      .expect(201);

    expect(body.note.body).toBe('Site lead called, field team en route.');

    const detail = await api().get('/api/alerts/ALT-1042').expect(200);
    const parsed = AlertDetailResponseSchema.parse(detail.body);
    expect(parsed.notes.at(-1)?.author).toBe('A. Tester');
    expect(parsed.events.map((event) => event.kind)).toContain('note_added');
  });

  it('does not consume the concurrency token', async () => {
    // A note cannot conflict with another operator's note. Bumping the version here would
    // cause spurious 409s on an unrelated status change the operator had already staged.
    await api().post('/api/alerts/ALT-1042/notes').send({ body: 'observation' }).expect(201);

    await api()
      .patch('/api/alerts/ALT-1042')
      .send({ status: 'acknowledged', expectedVersion: 0 })
      .expect(200);
  });

  it.each([
    ['an empty body', { body: '' }],
    ['whitespace only', { body: '   \n\t  ' }],
    ['an oversized body', { body: 'x'.repeat(2001) }],
  ])('rejects %s', async (_label, payload) => {
    const { body } = await api().post('/api/alerts/ALT-1042/notes').send(payload).expect(400);
    expect(body.error.code).toBe('bad_request');
  });

  it('trims surrounding whitespace rather than storing it', async () => {
    const { body } = await api()
      .post('/api/alerts/ALT-1042/notes')
      .send({ body: '   padded note   ' })
      .expect(201);
    expect(body.note.body).toBe('padded note');
  });

  it('404s on an unknown alert', async () => {
    await api().post('/api/alerts/NOPE/notes').send({ body: 'hello' }).expect(404);
  });
});

describe('error envelope', () => {
  it('returns a request id on every error and echoes a supplied one', async () => {
    const { body } = await api()
      .get('/api/alerts/NOPE')
      .set('x-request-id', 'trace-me-123')
      .expect(404);
    expect(body.error.requestId).toBe('trace-me-123');
  });

  it('reports malformed JSON as a 400, not a 500', async () => {
    const { body } = await api()
      .patch('/api/alerts/ALT-1041')
      .set('content-type', 'application/json')
      .send('{ this is not json')
      .expect(400);
    expect(body.error.code).toBe('bad_request');
  });

  it('404s an unknown route with the same envelope', async () => {
    const { body } = await api().get('/api/nothing-here').expect(404);
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });
});
