import { z } from 'zod';
import { SiteKindSchema, type Site } from '@incident-board/shared';
import type { Db } from '../db/client.js';
import { hydrateRows } from '../db/hydrate.js';

const SiteRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: SiteKindSchema,
    capacity_mw: z.number(),
    energy_mwh: z.number().nullable(),
    region: z.string(),
    timezone: z.string(),
    grid_operator: z.string(),
  })
  .transform(
    (row): Site => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      capacityMw: row.capacity_mw,
      energyMwh: row.energy_mwh,
      region: row.region,
      timezone: row.timezone,
      gridOperator: row.grid_operator,
    }),
  );

const COLUMNS = `id, name, kind, capacity_mw, energy_mwh, region, timezone, grid_operator`;

export type SitesRepository = ReturnType<typeof createSitesRepository>;

export function createSitesRepository(db: Db) {
  const listStmt = db.prepare(`SELECT ${COLUMNS} FROM sites ORDER BY name ASC`);
  const insertStmt = db.prepare(`
    INSERT INTO sites (${COLUMNS})
    VALUES (@id, @name, @kind, @capacity_mw, @energy_mwh, @region, @timezone, @grid_operator)
  `);

  return {
    list(): Site[] {
      return hydrateRows('sites', SiteRowSchema, listStmt.all());
    },

    /**
     * Largest site by AC capacity, used to normalise the capacity weighting in the triage
     * score. Returns 0 for an empty portfolio, which the scorer treats as "no weighting".
     */
    maxCapacityMw(): number {
      const row = db.prepare('SELECT COALESCE(MAX(capacity_mw), 0) AS max FROM sites').get();
      return z.object({ max: z.number() }).parse(row).max;
    },

    insert(site: Site): void {
      insertStmt.run({
        id: site.id,
        name: site.name,
        kind: site.kind,
        capacity_mw: site.capacityMw,
        energy_mwh: site.energyMwh,
        region: site.region,
        timezone: site.timezone,
        grid_operator: site.gridOperator,
      });
    },

    count(): number {
      const row = db.prepare('SELECT COUNT(*) AS count FROM sites').get();
      return z.object({ count: z.number().int() }).parse(row).count;
    },
  };
}
