# Changelog

## 0.1.0 — 2026-11-11

- Primera versión pública de **dsh-plugin-hermano**: memoria persistente para
  DeepSeek Harness.
- Carga `PREFERENCIAS_WENDIGO.md` al conectar y las inyecta como instrucciones
  del servidor MCP (búsqueda automática en Desktop/OneDrive Desktop + config).
- Tools: `memory_get`, `memory_save` (con `confirm:true`), `memory_list`,
  `memory_search`, `memory_config`.
- Notas en `notas.jsonl` con espejo legible `NOTAS_WENDIGO.md`.
- Seguridad: rechazo de secretos, rate limit de 20 notas/minuto, auditoría en
  `audit.jsonl`, modo `read-only` por variable de entorno.
- Bundle single-file con esbuild, `postinstall` que despliega a
  `<DSH_HOME>\plugins\hermano`, workflow de publicación en npm.
