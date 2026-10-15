/**
 * D1 reads for mcps/icij-offshore-leaks.
 *
 * Data: ICIJ's own Offshore Leaks Database bulk CSV export -- five
 * investigations (Offshore Leaks 2013, Panama Papers 2016, Bahamas Leaks
 * 2016, Paradise Papers 2017, Pandora Papers 2021) covering offshore
 * entities, the officers and intermediaries linked to them, their
 * registered addresses, and the edges between all of them. Loaded into a
 * D1 database the gateway hands this pack as `_d1` (pack-manifest
 * "d1Binding": "ICIJ_OFFSHORE_LEAKS_DB") by
 * scripts/icij-offshore-leaks/load-data.mjs -- never a bundled import. The
 * full node+edge set is ~2.0M nodes and ~3.3M relationships, so it belongs
 * in a store, not a `./data.json` import (see that loader's header for the
 * gateway-bundle-ceiling incident this avoids).
 *
 * LICENCE, quoted verbatim from ICIJ (offshoreleaks.icij.org/pages/faq) and
 * carried on EVERY response via `SOURCE` below -- the database itself is
 * under the Open Database License (ODbL); its contents under Creative
 * Commons Attribution-ShareAlike. ICIJ's own words: "Always cite the
 * International Consortium of Investigative Journalists when using this
 * data." Redistribution of this data (which this pack's D1 copy is) must
 * stay attributed and share-alike -- do not strip SOURCE off any response.
 *
 * PERSONAL DATA: officer names in this dataset are the same names ICIJ
 * itself already publishes at offshoreleaks.icij.org -- no enrichment with
 * any other personal-data source. ICIJ's own caveat, quoted verbatim, rides
 * on every response for the same reason the licence does: "The inclusion of
 * a person or entity in the ICIJ Offshore Leaks Database is not intended to
 * suggest or imply that they have engaged in illegal or improper conduct."
 * Never drop SOURCE.caveat from a response to save bytes.
 *
 * SEARCH: a standalone (non-external-content) FTS5 table, `offshore_name_fts`,
 * decoupled from `offshore_node`'s rowid on purpose -- joined back by the
 * TEXT `node_id` column, not by FTS5 `content=`/`content_rowid=`. That
 * sidesteps BOTH known D1-FTS5 traps at once (reference-d1-fts5-import-trap):
 * (1) a chunked base-table import never populates FTS postings, so the
 * loader rebuilds offshore_name_fts with its own batched
 * INSERT INTO ... SELECT statements run server-side AFTER the base tables
 * are loaded and row-count-verified, never assumed to ride along with the
 * import; (2) an external-content FTS naming a column the base table lacks
 * errors live on D1 but degrades quietly under node:sqlite's shim, which
 * would have hidden the bug from local smoke -- a standalone table has no
 * such column-name contract to violate in the first place.
 *
 * NOTE on placeholders: D1's local smoke shim mangles NUMBERED placeholders
 * (`?1`) -- every statement here uses plain, positional `?`.
 */

export interface D1Like {
  prepare(sql: string): D1StmtLike;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export class StoreUnavailableError extends Error {
  constructor() {
    super(
      'icij-offshore-leaks: the Offshore Leaks store is not bound in this runtime (no _d1). These tools only answer through the Pipeworx gateway; a standalone install has no data to read.',
    );
    this.name = 'StoreUnavailableError';
  }
}
export function requireDb(d1: unknown): D1Like {
  if (!d1 || typeof (d1 as D1Like).prepare !== 'function') throw new StoreUnavailableError();
  return d1 as D1Like;
}

export const SOURCE = {
  source: 'International Consortium of Investigative Journalists (ICIJ), Offshore Leaks Database',
  source_url: 'https://offshoreleaks.icij.org',
  licence:
    'Open Database License (ODbL) for the database; contents under Creative Commons Attribution-ShareAlike. ICIJ: "Always cite the International Consortium of Investigative Journalists when using this data."',
  caveat:
    'ICIJ: "The inclusion of a person or entity in the ICIJ Offshore Leaks Database is not intended to suggest or imply that they have engaged in illegal or improper conduct." Many people and entities share the same or similar names.',
};

export type NodeType = 'entity' | 'officer' | 'intermediary' | 'address' | 'other';

export interface NodeRow {
  id: number;
  node_id: string;
  node_type: NodeType;
  name: string | null;
  original_name: string | null;
  former_name: string | null;
  jurisdiction: string | null;
  jurisdiction_description: string | null;
  company_type: string | null;
  address: string | null;
  status: string | null;
  service_provider: string | null;
  countries: string | null;
  country_codes: string | null;
  incorporation_date: string | null;
  struck_off_date: string | null;
  dorm_date: string | null;
  inactivation_date: string | null;
  closed_date: string | null;
  internal_id: string | null;
  ibc_ruc: string | null;
  note: string | null;
  source_id: string | null;
  leak: string | null;
  valid_until: string | null;
}

export interface RelatedRow {
  node_id_start: string;
  node_id_end: string;
  rel_type: string | null;
  link: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  source_id: string | null;
  leak: string | null;
  start_name: string | null;
  start_type: string | null;
  end_name: string | null;
  end_type: string | null;
}

function shapeNodeSummary(r: NodeRow) {
  return {
    node_id: r.node_id,
    node_type: r.node_type,
    name: r.name,
    jurisdiction: r.jurisdiction,
    jurisdiction_description: r.jurisdiction_description,
    status: r.status,
    countries: r.countries,
    leak: r.leak,
  };
}

export function shapeNodeFull(r: NodeRow) {
  return {
    node_id: r.node_id,
    node_type: r.node_type,
    name: r.name,
    original_name: r.original_name,
    former_name: r.former_name,
    jurisdiction: r.jurisdiction,
    jurisdiction_description: r.jurisdiction_description,
    company_type: r.company_type,
    address: r.address,
    status: r.status,
    service_provider: r.service_provider,
    countries: r.countries,
    country_codes: r.country_codes,
    incorporation_date: r.incorporation_date,
    struck_off_date: r.struck_off_date,
    dorm_date: r.dorm_date,
    inactivation_date: r.inactivation_date,
    closed_date: r.closed_date,
    internal_id: r.internal_id,
    ibc_ruc: r.ibc_ruc,
    note: r.note,
    leak: r.leak,
    source_id: r.source_id,
  };
}

export function shapeRelated(queriedNodeId: string, r: RelatedRow) {
  const outgoing = r.node_id_start === queriedNodeId;
  const otherNodeId = outgoing ? r.node_id_end : r.node_id_start;
  const otherName = outgoing ? r.end_name : r.start_name;
  const otherType = outgoing ? r.end_type : r.start_type;
  return {
    direction: outgoing ? 'outgoing' : 'incoming',
    node_id: otherNodeId,
    name: otherName,
    node_type: otherType,
    role: r.link,
    rel_type: r.rel_type,
    status: r.status,
    start_date: r.start_date,
    end_date: r.end_date,
    leak: r.leak,
  };
}

/** FTS5 MATCH query built from free-text input: each whitespace-split token,
 *  quoted (so punctuation in a name can't be read as an FTS5 operator) and
 *  suffixed with `*` for prefix matching, AND'd together. Empty input ->
 *  null (caller should reject before querying). */
export function buildMatchQuery(raw: string): string | null {
  const tokens = raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"*`);
  if (!tokens.length) return null;
  return tokens.join(' AND ');
}

export interface SearchFilters {
  matchQuery: string;
  jurisdiction: string | null;
  nodeType: NodeType | null;
  limit: number;
}

export async function searchNodes(db: D1Like, f: SearchFilters): Promise<{ rows: NodeRow[]; total: number }> {
  const clauses: string[] = ['offshore_name_fts MATCH ?'];
  const args: unknown[] = [f.matchQuery];
  if (f.jurisdiction) {
    clauses.push('LOWER(o.jurisdiction) = LOWER(?)');
    args.push(f.jurisdiction);
  }
  if (f.nodeType) {
    clauses.push('o.node_type = ?');
    args.push(f.nodeType);
  }
  const where = clauses.join(' AND ');
  // COUNT then SELECT ... LIMIT with the SAME filtered WHERE, rather than
  // over-fetching a capped FTS-rank candidate window and filtering in JS --
  // a capped window silently misses real matches once jurisdiction/node_type
  // narrows a common name token down to a small, rank-scattered subset (found
  // 2026-10-14: "Trust" + a real jurisdiction combination almost read as
  // no_match purely from the cap, not from an absent match). FTS5's MATCH is
  // index-driven either way, so neither query scans unindexed rows.
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM offshore_name_fts f JOIN offshore_node o ON o.node_id = f.node_id WHERE ${where}`)
    .bind(...args)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  if (total === 0) return { rows: [], total: 0 };
  const { results } = await db
    .prepare(
      `SELECT o.* FROM offshore_name_fts f
       JOIN offshore_node o ON o.node_id = f.node_id
       WHERE ${where}
       ORDER BY rank
       LIMIT ?`,
    )
    .bind(...args, f.limit)
    .all<NodeRow>();
  return { rows: results, total };
}

export async function getNode(db: D1Like, nodeId: string): Promise<NodeRow | null> {
  return db.prepare('SELECT * FROM offshore_node WHERE node_id = ?').bind(nodeId).first<NodeRow>();
}

export async function getRelated(db: D1Like, nodeId: string, limit: number): Promise<{ rows: RelatedRow[]; total: number }> {
  const countRow = await db
    .prepare('SELECT COUNT(*) AS n FROM offshore_relationship WHERE node_id_start = ? OR node_id_end = ?')
    .bind(nodeId, nodeId)
    .first<{ n: number }>();
  const total = Number(countRow?.n ?? 0);
  if (total === 0) return { rows: [], total: 0 };
  const { results } = await db
    .prepare(
      `SELECT r.node_id_start, r.node_id_end, r.rel_type, r.link, r.status, r.start_date, r.end_date, r.source_id, r.leak,
              ns.name AS start_name, ns.node_type AS start_type,
              ne.name AS end_name, ne.node_type AS end_type
       FROM offshore_relationship r
       LEFT JOIN offshore_node ns ON ns.node_id = r.node_id_start
       LEFT JOIN offshore_node ne ON ne.node_id = r.node_id_end
       WHERE r.node_id_start = ? OR r.node_id_end = ?
       ORDER BY r.id
       LIMIT ?`,
    )
    .bind(nodeId, nodeId, limit)
    .all<RelatedRow>();
  return { rows: results, total };
}

export interface Meta {
  data_as_of: string | null;
  total_nodes: number;
  total_relationships: number;
}

let cachedMeta: Meta | null = null;
export async function getMeta(db: D1Like): Promise<Meta> {
  if (cachedMeta) return cachedMeta;
  const row = await db.prepare("SELECT value FROM offshore_meta WHERE key = 'data_as_of'").first<{ value: string }>();
  const nodeRow = await db.prepare('SELECT COUNT(*) AS n FROM offshore_node').first<{ n: number }>();
  const relRow = await db.prepare('SELECT COUNT(*) AS n FROM offshore_relationship').first<{ n: number }>();
  cachedMeta = {
    data_as_of: row?.value ?? null,
    total_nodes: Number(nodeRow?.n ?? 0),
    total_relationships: Number(relRow?.n ?? 0),
  };
  return cachedMeta;
}

export { shapeNodeSummary };
