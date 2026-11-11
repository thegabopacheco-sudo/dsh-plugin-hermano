# How dsh-plugin-hermano works

A local MCP server that gives DeepSeek Harness a persistent memory: it reads
your preferences file at startup, publishes it as MCP **server instructions**
(so every session receives it automatically) and stores local notes with
confirmation, audit and a read-only mode.

## Startup

1. Resolve `DSH_HOME` (`%USERPROFILE%\.dsh` by default).
2. Find the preferences file: `DSH_HERMANO_PREFS` → `preferencesPath` in
   `<DSH_HOME>\hermano\config.json` → `<DSH_HOME>\hermano\PREFERENCIAS_WENDIGO.md`
   → Desktop/OneDrive Desktop → bounded search (depth 3) under those folders.
3. Read the file (first 16 KB embedded in the instructions; full text available
   through `memory_get`).
4. Build the server instructions with the preferences, memory rules and note
   count. DSH injects them on every MCP connection.

## Tools

| Tool | Purpose |
|---|---|
| `memory_get` | Current preferences + recent notes. |
| `memory_save` | Save a note (`confirm:true` required; secrets rejected; rate limited). |
| `memory_list` | List notes by scope/tag. |
| `memory_search` | Accent/case-insensitive search. |
| `memory_config` | Show config; set a new `preferencesPath` with `confirm:true`. |

Notes live in `<DSH_HOME>\hermano\notas.jsonl` (one JSON per line) with a
human-readable mirror at `<DSH_HOME>\hermano\NOTAS_WENDIGO.md`.

## Safety

- Read-only by default in spirit: only `memory_save` writes, and it requires
  `confirm:true` plus explicit user confirmation in the conversation.
- Secrets (tokens, API keys, passwords, private keys) are rejected.
- 20 writes/minute rate limit.
- Every write is appended to `<DSH_HOME>\cache\hermano\audit.jsonl` (without the
  note text).
- `DSH_HERMANO_MODE=read-only` disables writes entirely.

## Architecture

```
DSH ──MCP stdio──► server.mjs (single-file esbuild bundle)
                      ├─ preferences file → server instructions
                      └─ notas.jsonl + NOTAS_WENDIGO.md + audit + rate limit
```

- `@modelcontextprotocol/server@2.2.0` (2026-07-28 protocol) + `serveStdio`,
  matching DSH's MCP client generation.
- `cordis.patch.yml` inserts one `@deepseek-ai/dsh-mcp-client` row
  (`serverName: hermano`) with no machine paths.
- `postinstall` deploys `<DSH_HOME>\plugins\hermano\server.mjs`; `dist/` is
  committed so `github:` installs need no build step.

## Troubleshooting

- **"Install scripts need your permission"**: approve the postinstall. If the
  dialog loops, check the profile's `pnpm-workspace.yaml`: `allowBuilds` values
  must be `true`, not the literal `set this to true or false` placeholder.
- **Tools missing**: check `<DSH_HOME>\plugins\hermano\server.mjs`, the
  `mcp-hermano` row in the profile patch, and restart DSH.
- **Preferences not found**: use `memory_config` with an absolute path and
  `confirm:true`.
