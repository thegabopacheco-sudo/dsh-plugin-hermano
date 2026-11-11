# dsh-plugin-hermano — persistent memory for DeepSeek Harness

A local MCP plugin that gives the agent **memory**: it reads your
`PREFERENCIAS_WENDIGO.md` at startup, publishes those preferences as MCP
**server instructions** in every session, and stores local notes with
confirmation, audit and a read-only mode. No external service, no database, no
native dependencies.

[Español](README.md) · [How it works](docs/HOW-IT-WORKS.md) · MIT

## What it does

- **Loads your preferences** (language, tone, working style, project) from
  `PREFERENCIAS_WENDIGO.md` and injects them through the MCP connection.
- **Stores notes** that survive across sessions: new preferences, project
  decisions, tone, reminders.
- **Returns them on demand** with search and scope/tag filters.
- **Never stores secrets**: rejects tokens, API keys, passwords and private keys.
- **Writes only with confirmation**: `memory_save` requires `confirm:true` and the
  instructions ask for explicit user confirmation first.

## Tools (5)

| Tool | Purpose |
|---|---|
| `mcp__hermano__memory_get` | Current preferences + recent notes. |
| `mcp__hermano__memory_save` | Save a note (`confirm:true`; secrets rejected; rate limited). |
| `mcp__hermano__memory_list` | List notes by `scope` (`global`/`wendigo`/`project`) and/or `tag`. |
| `mcp__hermano__memory_search` | Accent/case-insensitive text search. |
| `mcp__hermano__memory_config` | Show config; set a new preferences path with `confirm:true`. |

## Install

From **DSH → Settings → Plugins** install
`github:thegabopacheco-sudo/dsh-plugin-hermano` and approve the install script
when DSH asks for it.

Or via CLI for non-app-managed profiles:

```
dsh plugin --profile <profile> add github:thegabopacheco-sudo/dsh-plugin-hermano
```

The `postinstall` deploys the runtime to `<DSH_HOME>\plugins\hermano` and, when
`PREFERENCIAS_WENDIGO.md` is found in a known location, leaves its path in the
config file.

Requirements: Windows 10/11 and Node >= 20 (provided by the harness).

## Where data lives

| Path | Content |
|---|---|
| `<DSH_HOME>\hermano\notas.jsonl` | Note data (one JSON per line). |
| `<DSH_HOME>\hermano\NOTAS_WENDIGO.md` | Human-readable mirror. |
| `<DSH_HOME>\hermano\config.json` | Preferences path. |
| `<DSH_HOME>\cache\hermano\audit.jsonl` | Write audit (no note text). |
| `<DSH_HOME>\plugins\hermano\server.mjs` | Runtime deployed by postinstall. |

## Preferences lookup

1. `DSH_HERMANO_PREFS` environment variable.
2. `preferencesPath` from `<DSH_HOME>\hermano\config.json`.
3. `<DSH_HOME>\hermano\PREFERENCIAS_WENDIGO.md`.
4. `Desktop` / `OneDrive\Desktop` (bounded depth-3 search).

It can be changed at runtime with `memory_config` + `confirm:true`.

## Safety

- Read-only by nature: only `memory_save` writes.
- Explicit confirmation required (`confirm:true`).
- Known secret patterns are rejected.
- 20 notes/minute rate limit.
- Audit log at `cache\hermano\audit.jsonl`.
- Read-only mode: `DSH_HERMANO_MODE=read-only`.

## Environment

| Variable | Use |
|---|---|
| `DSH_HOME` | DSH root (default `%USERPROFILE%\.dsh`). |
| `DSH_HERMANO_PREFS` | Explicit preferences file path. |
| `DSH_HERMANO_MODE` | `read-only` disables writes. |
| `DSH_HERMANO_SKIP_POSTINSTALL` | `1` skips the postinstall deploy. |

## Troubleshooting

- **"Install scripts need your permission"**: approve the postinstall. If the
  dialog loops, check the profile's `pnpm-workspace.yaml`: `allowBuilds` values
  must be `true`, not the literal `set this to true or false` placeholder.
- **Tools missing**: check `<DSH_HOME>\plugins\hermano\server.mjs` and the
  `mcp-hermano` row in the profile patch; restart DSH if needed.
- **Preferences not found**: set the path with `memory_config`.

## Development

```powershell
npm install
npm run build:bundle     # dist/server.mjs (esbuild)
cd test; npm install; node connect-test.mjs
```

`prepack` rebuilds the bundle before publishing; `dist/` is committed so GitHub
installs need no build step.

## License

MIT © thegabopacheco-sudo
