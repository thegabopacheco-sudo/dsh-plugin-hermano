# dsh-plugin-hermano — memoria persistente para DeepSeek Harness

Plugin MCP local que le da **memoria** al agente: lee tu `PREFERENCIAS_WENDIGO.md`
al iniciar, inyecta las preferencias en **todas las sesiones** como instrucciones
del servidor y guarda notas locales con confirmación, auditoría y modo read-only.
Sin servidor externo, sin base de datos y sin dependencias nativas.

[English](README.en.md) · [Cómo funciona](docs/COMO-FUNCIONA.md) · MIT

## Qué hace

- **Carga tus preferencias** (idioma, trato, forma de trabajar, proyecto) desde
  `PREFERENCIAS_WENDIGO.md` y las publica como instrucciones del MCP.
- **Registra notas** que sobreviven entre sesiones: preferencias nuevas,
  decisiones de proyecto, tono, recordatorios.
- **Las devuelve cuando hacen falta** con búsqueda y filtros por alcance/tag.
- **Nunca guarda secretos**: rechaza tokens, claves API, contraseñas y claves
  privadas.
- **Escritura solo con confirmación**: `memory_save` exige `confirm:true` y las
  instrucciones piden confirmación explícita del usuario.

## Herramientas (5)

| Tool | Qué hace |
|---|---|
| `mcp__hermano__memory_get` | Preferencias actuales + notas recientes. |
| `mcp__hermano__memory_save` | Guarda una nota (`confirm:true`; rechaza secretos; rate limit). |
| `mcp__hermano__memory_list` | Lista notas por `scope` (`global`/`wendigo`/`project`) y/o `tag`. |
| `mcp__hermano__memory_search` | Búsqueda por texto sin distinguir mayúsculas ni acentos. |
| `mcp__hermano__memory_config` | Muestra la configuración; cambia la ruta de preferencias con `confirm:true`. |

## Instalación

**Desde DSH → Settings → Plugins** (recomendado): instala
`github:thegabopacheco-sudo/dsh-plugin-hermano` y permite el script de
instalación cuando DSH lo pida.

**Por CLI** (para perfiles que no administra la app):

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-hermano
```

El `postinstall` copia el runtime a `<DSH_HOME>\plugins\hermano` y, si encuentra
`PREFERENCIAS_WENDIGO.md` en las rutas habituales, deja la ruta configurada.

Requisitos: Windows 10/11 y Node ≥ 20 (lo aporta el harness).

## Dónde guarda las cosas

| Ruta | Contenido |
|---|---|
| `<DSH_HOME>\hermano\notas.jsonl` | Datos de las notas (una por línea). |
| `<DSH_HOME>\hermano\NOTAS_WENDIGO.md` | Espejo legible para humanos. |
| `<DSH_HOME>\hermano\config.json` | Ruta del archivo de preferencias. |
| `<DSH_HOME>\cache\hermano\audit.jsonl` | Auditoría de escrituras (sin el texto). |
| `<DSH_HOME>\plugins\hermano\server.mjs` | Runtime desplegado por el postinstall. |

## Búsqueda de preferencias

Orden de resolución:

1. Variable de entorno `DSH_HERMANO_PREFS`.
2. `preferencesPath` de `<DSH_HOME>\hermano\config.json`.
3. `<DSH_HOME>\hermano\PREFERENCIAS_WENDIGO.md`.
4. `Desktop` y `OneDrive\Desktop` (incluida búsqueda acotada de profundidad 3).

Puedes fijar la ruta en cualquier momento:

```json
{ "preferencesPath": "C:\\ruta\\a\\PREFERENCIAS_WENDIGO.md", "confirm": true }
```

## Seguridad

- Lectura por defecto; solo `memory_save` escribe.
- Escritura con confirmación explícita (`confirm:true`).
- Rechazo de secretos por patrones conocidos.
- Rate limit de 20 notas por minuto.
- Auditoría en `cache\hermano\audit.jsonl`.
- Modo read-only: `DSH_HERMANO_MODE=read-only`.

## Variables de entorno

| Variable | Uso |
|---|---|
| `DSH_HOME` | Raíz de DSH (default `%USERPROFILE%\.dsh`). |
| `DSH_HERMANO_PREFS` | Ruta explícita a `PREFERENCIAS_WENDIGO.md`. |
| `DSH_HERMANO_MODE` | `read-only` desactiva escrituras. |
| `DSH_HERMANO_SKIP_POSTINSTALL` | `1` omite el despliegue del postinstall. |

## Solución de problemas

- **“A dependency's install scripts need your permission”**: es el permiso del
  `postinstall`. Haz clic en *Allow these scripts and retry*. Si el cartel vuelve
  en bucle, revisa `<perfil>\pnpm-workspace.yaml`: las claves de `allowBuilds`
  deben valer `true` (no el texto `set this to true or false`).
- **No aparecen las tools**: verifica `<DSH_HOME>\plugins\hermano\server.mjs` y
  la fila `mcp-hermano` en el patch del perfil; reinicia DSH si hace falta.
- **No encuentra preferencias**: usa `memory_config` con una ruta absoluta.

## Desarrollo

```powershell
npm install
npm run build:bundle     # dist/server.mjs (esbuild)
cd test; npm install; node connect-test.mjs
```

`prepack` reconstruye el bundle antes de publicar; `dist/` queda commiteado para
que las instalaciones desde GitHub no necesiten compilar.

## Licencia

MIT © thegabopacheco-sudo
