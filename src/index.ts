interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * ICIJ Offshore Leaks Database -- offshore entities, officers,
 * intermediaries and the relationships between them, across five ICIJ
 * investigations (Offshore Leaks, Panama Papers, Bahamas Leaks, Paradise
 * Papers, Pandora Papers).
 *
 * ICIJ publishes this as a bulk CSV download (~2.0M nodes, ~3.3M
 * relationship edges) under the Open Database License, not a callable API
 * -- BUILD THE COPY applies (CLAUDE.md "What we will source"). See
 * src/store.ts for how the copy is held (D1, loaded by
 * scripts/icij-offshore-leaks/load-data.mjs -- never a bundled import) and
 * for the exact licence + caveat text, which every tool below carries
 * verbatim on every response, found or not.
 *
 * PERSONAL DATA: officer names here are the same names ICIJ itself already
 * publishes. No enrichment with any other personal-data source, and no
 * tool here resolves a name to anything ICIJ did not already publish about
 * it (role, jurisdiction, the leak it came from).
 *
 * REFRESH: ICIJ updates the bulk export on its own schedule (it has shipped
 * five point-in-time investigations since 2013, most recently Pandora
 * Papers in 2021, with incremental corrections since). `node
 * scripts/icij-offshore-leaks/load-data.mjs` re-downloads the current
 * export and reloads the store. `data_as_of` on every response is the
 * export's own generation date at the time of the last load.
 */

import {
  SOURCE,
  buildMatchQuery,
  getMeta,
  getNode,
  getRelated,
  requireDb,
  searchNodes,
  shapeNodeFull,
  shapeNodeSummary,
  shapeRelated,
  type NodeType,
} from './store.js';

function capped(limit: unknown, fallback = 50, max = 200): number {
  const n = typeof limit === 'number' ? limit : fallback;
  return Math.max(1, Math.min(max, Math.floor(n)));
}

const NODE_TYPES: NodeType[] = ['entity', 'officer', 'intermediary', 'address', 'other'];
function parseNodeType(v: unknown): NodeType | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  return (NODE_TYPES as string[]).includes(s) ? (s as NodeType) : null;
}

const tools: McpToolExport['tools'] = [
  {
    name: 'offshore_search',
    description:
      'Search the ICIJ Offshore Leaks Database by name for offshore entities, officers (directors/shareholders/beneficiaries) and intermediaries (registered agents, law firms, banks) named across five ICIJ investigations: Offshore Leaks, Panama Papers, Bahamas Leaks, Paradise Papers and Pandora Papers. Answers "is [name] in the Panama Papers", "offshore companies registered in [jurisdiction]", "who is [person] linked to offshore". Matches on name (prefix-aware, e.g. "Mossack" matches "Mossack Fonseca"). Returns each match\'s node_id, type, jurisdiction, status and which leak it came from -- call offshore_entity with a node_id for full details and linked officers/intermediaries. Every response carries ICIJ\'s own licence attribution and its caveat that inclusion is not evidence of wrongdoing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name (or part of a name) to search for, e.g. "Mossack Fonseca", "Wintris".' },
        jurisdiction: { type: 'string', description: 'Filter by jurisdiction name as ICIJ records it, e.g. "British Virgin Islands", "Panama". Exact match, case-insensitive.' },
        node_type: { type: 'string', enum: NODE_TYPES, description: 'Restrict to one kind of node: "entity" (offshore company/trust/foundation), "officer" (director/shareholder/beneficiary), "intermediary" (registered agent/law firm/bank), "address", or "other".' },
        limit: { type: 'number', description: 'Max results to return (default 50, max 200).' },
      },
      required: ['name'],
    },
  },
  {
    name: 'offshore_entity',
    description:
      'Fetch one node from the ICIJ Offshore Leaks Database by its node_id -- full details (name, jurisdiction, status, incorporation/struck-off dates, registered agent) plus every linked officer, intermediary, entity or address, with the relationship role ("shareholder of", "registered address", "intermediary of") and which ICIJ leak each link comes from. Use after offshore_search returns a node_id. Works for any node type (entity, officer, intermediary, address, other) -- officers and intermediaries show the entities they are linked to, and entities show their officers/intermediaries/addresses.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: { type: 'string', description: 'The node_id returned by offshore_search, e.g. "10206223".' },
        limit: { type: 'number', description: 'Max linked relationships to return (default 50, max 200).' },
      },
      required: ['node_id'],
    },
  },
];

function noMatch(hint: string, extra?: Record<string, unknown>) {
  return { found: false, reason: 'no_match', hint, ...SOURCE, ...extra };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'offshore_search': {
      const db = requireDb(args._d1);
      const nameRaw = typeof args.name === 'string' ? args.name.trim() : '';
      const meta = await getMeta(db);
      if (!nameRaw) {
        return noMatch('Provide a name (or part of one) to search for.', { data_as_of: meta.data_as_of });
      }
      const matchQuery = buildMatchQuery(nameRaw);
      if (!matchQuery) {
        return noMatch('Provide a name (or part of one) to search for.', { data_as_of: meta.data_as_of });
      }
      const jurisdiction = typeof args.jurisdiction === 'string' && args.jurisdiction.trim() ? args.jurisdiction.trim() : null;
      const nodeType = parseNodeType(args.node_type);
      const limit = capped(args.limit);

      const { rows, total } = await searchNodes(db, { matchQuery, jurisdiction, nodeType, limit });
      if (!total) {
        return noMatch(
          `No node matched "${nameRaw}"${jurisdiction ? ` in jurisdiction "${jurisdiction}"` : ''}${nodeType ? ` of type "${nodeType}"` : ''}. ICIJ's dataset uses the entity's registered name as filed, which can differ from how a person or company is commonly known -- try a shorter fragment.`,
          { data_as_of: meta.data_as_of },
        );
      }
      return {
        found: true,
        returned: rows.length,
        truncated: total > rows.length,
        results: rows.map(shapeNodeSummary),
        ...SOURCE,
        data_as_of: meta.data_as_of,
      };
    }

    case 'offshore_entity': {
      const db = requireDb(args._d1);
      const nodeId = typeof args.node_id === 'string' ? args.node_id.trim() : '';
      const meta = await getMeta(db);
      if (!nodeId) return noMatch('Provide a node_id -- get one from offshore_search.', { data_as_of: meta.data_as_of });
      const node = await getNode(db, nodeId);
      if (!node) {
        return noMatch(`No node with node_id "${nodeId}" in this pack's dataset. Get a node_id from offshore_search first.`, { data_as_of: meta.data_as_of });
      }
      const limit = capped(args.limit);
      const { rows, total } = await getRelated(db, nodeId, limit);
      return {
        found: true,
        ...shapeNodeFull(node),
        linked_total: total,
        linked_returned: rows.length,
        linked_truncated: total > rows.length,
        linked: rows.map((r) => shapeRelated(nodeId, r)),
        ...SOURCE,
        data_as_of: meta.data_as_of,
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
