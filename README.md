# @pipeworx/icij-offshore-leaks

Search the ICIJ Offshore Leaks Database — offshore entities, officers
(directors/shareholders/beneficiaries) and intermediaries (registered
agents, law firms, banks) named across five ICIJ investigations (Offshore
Leaks 2013, Panama Papers 2016, Bahamas Leaks 2016, Paradise Papers 2017,
Pandora Papers 2021) — by name, or fetch one node's full profile plus every
linked officer/intermediary/entity/address and which leak each link came
from.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1807+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `offshore_search(name, jurisdiction?, node_type?, limit?)` — name search
  (prefix-aware FTS5) across entities, officers and intermediaries, with
  optional jurisdiction and node-type filters. Returns each match's
  `node_id`, type, jurisdiction, status and which leak it came from.
- `offshore_entity(node_id, limit?)` — one node's full profile (name,
  jurisdiction, status, incorporation/struck-off dates, registered agent)
  plus every linked relationship (role, direction, the other node's name and
  type, and the leak it comes from). Works for any node type.

## Auth

Keyless.

## Licence and caveat — every response carries both, verbatim

> The ICIJ Offshore Leaks Database is licensed under the **Open Database
> License (ODbL)** (contents under Creative Commons Attribution-ShareAlike).
> ICIJ: *"Always cite the International Consortium of Investigative
> Journalists when using this data."*

> ICIJ: *"The inclusion of a person or entity in the ICIJ Offshore Leaks
> Database is not intended to suggest or imply that they have engaged in
> illegal or improper conduct."* Many people and entities share the same or
> similar names.

This pack serves only what ICIJ itself already publishes — names, roles,
jurisdictions and links. No enrichment with any other personal-data source.

## Data source

- **International Consortium of Investigative Journalists (ICIJ), Offshore
  Leaks Database** (offshoreleaks.icij.org) — ICIJ's bulk CSV export of the
  graph behind its public database: ~814K entities, ~771K officers, ~27K
  intermediaries, ~402K addresses, ~3K other nodes, and ~3.34M relationship
  edges between them, across five point-in-time investigations.

**Store, not a bundled import, not a live query.** ICIJ publishes this as a
bulk CSV download under ODbL, not a callable API, so this is a BUILD-THE-COPY
pack (CLAUDE.md "What we will source"). The ~2.0M nodes and ~3.3M edges live
in a D1 database the gateway hands this pack as `_d1`
(`"d1Binding": "ICIJ_OFFSHORE_LEAKS_DB"` in `pack-manifest.json`; schema +
queries in `src/store.ts`) — at this size, a bundled import would have blown
the gateway Worker's bundle ceiling outright (28 MiB raw / 6.5 MiB gzip; this
dataset alone is ~1 GB of SQL).

**A known data quirk, handled in the loader:** ICIJ's export reuses the same
`node_id` for ~1,139 people across `nodes-officers.csv` AND
`nodes-intermediaries.csv` (identical name/country/source — e.g. node_id
51122, "Peng, Wan-Hsiung", filed as both). ICIJ's own site
(`offshoreleaks.icij.org/nodes/<id>`) resolves those ids to "Intermediary",
so the loader keeps the intermediary row and drops the officer duplicate for
any id that collides (`scripts/icij-offshore-leaks/fetch-icij-data.py`).

**Search is FTS5, not `LIKE`** — unlike smaller D1-store packs in this
catalog, ~1.6M searchable names is too many for a `LIKE '%term%'` scan to
answer reliably inside D1's per-query limits. `offshore_name_fts` is a
**standalone** FTS5 table (not `content=`/`content_rowid=`), decoupled from
`offshore_node`'s rowid and joined back by the `node_id` TEXT column —
chosen specifically to avoid the two known D1 FTS5 traps: a chunked base-table
import never populates FTS5 postings (so the loader rebuilds the index with
its own batched statements, server-side, AFTER the base load is verified
complete), and an external-content FTS naming a column the base table lacks
errors live on D1 while staying silent under a local sqlite smoke test.

**Refresh:**

```bash
python3 scripts/icij-offshore-leaks/fetch-icij-data.py --out /tmp/icij-ndjson
node scripts/icij-offshore-leaks/load-data.mjs --ndjson /tmp/icij-ndjson --db pipeworx-icij-offshore-leaks
```

ICIJ updates the bulk export on its own schedule (five point-in-time
investigations since 2013, most recently Pandora Papers in 2021, with
incremental corrections since). `data_as_of` on every response is the
export's own generation date as of the last load. This writes to production
D1 — only run it with that access; see "Production setup" below for the
one-time database creation this depends on.

### Production setup (one-time, not done by this pack's author — D1 writes are Bruce's call)

```bash
wrangler d1 create pipeworx-icij-offshore-leaks --location wnam
# then add the [[d1_databases]] block it prints to workers/gateway/wrangler.toml:
#   binding = "ICIJ_OFFSHORE_LEAKS_DB"
#   database_name = "pipeworx-icij-offshore-leaks"
#   database_id = "<from the create output>"

python3 scripts/icij-offshore-leaks/fetch-icij-data.py --out /tmp/icij-ndjson
node scripts/icij-offshore-leaks/load-data.mjs --ndjson /tmp/icij-ndjson --db pipeworx-icij-offshore-leaks
```

Verified locally against the real 2026-09-09 export (`--local-sqlite`
instead of `--db`, no network/wrangler involved): 2,016,523 nodes (814,344
entities, 770,176 officers, 26,768 intermediaries, 402,246 addresses, 2,989
other; 1,139 officer/intermediary duplicates deduped), 3,339,267
relationships, 1,611,197-row FTS index, loaded in well under a minute on a
single core. The resulting SQLite file is ~1.1 GB — comfortably inside D1's
10 GB (Workers Paid) database-size cap. The production load is dominated by
network round trips rather than CPU: the loader packs many
byte-capped `INSERT` statements per file (D1's single-statement cap is
100,000 bytes; `wrangler d1 execute --file` supports files up to 5 GiB), which
works out to ~74 files for `offshore_node`, ~50 for `offshore_relationship`,
and 41 server-side batches to rebuild `offshore_name_fts` — roughly 165
`wrangler d1 execute` round trips total, estimated 45–90 minutes depending on
D1 import latency per file.

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "icij-offshore-leaks": {
      "url": "https://gateway.pipeworx.io/icij-offshore-leaks/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/icij-offshore-leaks/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1807+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/offshore_search \
  -H 'Content-Type: application/json' \
  -d '{"name":"Wintris"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/offshore_search`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

```json
{
  "mcpServers": {
    "icij-offshore-leaks": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-icij-offshore-leaks"]
    }
  }
}
```

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-icij-offshore-leaks
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Icij Offshore Leaks data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
