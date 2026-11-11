# Cómo funciona dsh-plugin-hermano

Plugin MCP local para **DeepSeek Harness** que le da al agente una memoria
persistente: carga tus preferencias al iniciar, las inyecta en cada sesión y
guarda notas locales con confirmación y auditoría.

---

## 1. Idea

`dsh-plugin-eyes` le dio ojos y manos al agente. `dsh-plugin-hermano` le da
**memoria**: un lugar donde viven tus preferencias (idioma, trato, forma de
trabajar, proyecto WENDIGO) y las notas que quieras conservar entre sesiones.

La clave: las preferencias no dependen de que el modelo las recuerde. El
servidor las lee al arrancar y las publica como **instrucciones del servidor
MCP**, así el host las inyecta automáticamente en cada conexión.

---

## 2. Instalación

Recomendada desde **DSH → Settings → Plugins**:

```
github:thegabopacheco-sudo/dsh-plugin-hermano
```

o por CLI (perfiles que no administra la app):

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-hermano
```

El paquete trae un `postinstall` que copia el runtime a
`<DSH_HOME>\plugins\hermano`. pnpm puede pedir permiso para ejecutar el script
(ver [solución de problemas](#8-solución-de-problemas)).

Requisitos: Windows 10/11, Node ≥ 20 (lo aporta el harness). No hay binarios
nativos ni dependencias externas.

---

## 3. Qué hace al arrancar

1. Resuelve `DSH_HOME` (`%USERPROFILE%\.dsh` por defecto).
2. Busca el archivo de preferencias en este orden:
   - variable `DSH_HERMANO_PREFS`;
   - `preferencesPath` guardado en `<DSH_HOME>\hermano\config.json`;
   - `<DSH_HOME>\hermano\PREFERENCIAS_WENDIGO.md`;
   - `Desktop\PREFERENCIAS_WENDIGO.md` y `OneDrive\Desktop\PREFERENCIAS_WENDIGO.md`;
   - búsqueda acotada (profundidad 3) dentro de `Desktop` y `OneDrive\Desktop`.
3. Lee el archivo (16 KB máximo dentro de las instrucciones; el resto queda
   disponible con `memory_get`).
4. Construye las **instrucciones del servidor** con tus preferencias + reglas de
   uso de la memoria + cantidad de notas guardadas.
5. Al conectar, el cliente MCP de DSH registra las tools `mcp__hermano__*`.

Si el archivo cambia, `memory_get` siempre lee la versión actual; las
instrucciones se recargan en la próxima conexión (sesión nueva o reinicio).

---

## 4. Herramientas

| Tool | Qué hace |
|---|---|
| `memory_get` | Devuelve las preferencias actuales y las notas más recientes. |
| `memory_save` | Guarda una nota (`confirm:true` obligatorio). Rechaza secretos y aplica rate limit. |
| `memory_list` | Lista notas, filtrable por `scope` (`global`/`wendigo`/`project`) y `tag`. |
| `memory_search` | Busca notas por texto sin distinguir mayúsculas ni acentos. |
| `memory_config` | Muestra la configuración; con `preferencesPath` + `confirm:true` cambia la ruta del archivo de preferencias. |

Cada nota se guarda como una línea JSON en `<DSH_HOME>\hermano\notas.jsonl` y se
refleja en `<DSH_HOME>\hermano\NOTAS_WENDIGO.md` (espejo legible para humanos).

---

## 5. Seguridad

- **Lectura por defecto**: las tools de lectura no escriben nada.
- **Escritura con confirmación**: `memory_save` exige `confirm:true` y las
  instrucciones piden confirmación explícita del usuario antes de llamarla.
- **Nunca secretos**: se rechazan tokens, claves API, contraseñas y claves
  privadas (patrones conocidos).
- **Rate limit**: 20 notas por minuto como máximo.
- **Auditoría**: cada escritura agrega una línea a
  `<DSH_HOME>\cache\hermano\audit.jsonl` (sin guardar el texto de la nota).
- **Modo read-only**: `DSH_HERMANO_MODE=read-only` desactiva las escrituras.

También se aplican las reglas de WENDIGO del propio archivo de preferencias:
español neutro, sin voseo, tono directo y sin adulación.

---

## 6. Variables de entorno

| Variable | Uso |
|---|---|
| `DSH_HOME` | Raíz de DSH (default `%USERPROFILE%\.dsh`). |
| `DSH_HERMANO_PREFS` | Ruta explícita a `PREFERENCIAS_WENDIGO.md`. |
| `DSH_HERMANO_MODE` | `read-only` desactiva las escrituras. |
| `DSH_HERMANO_SKIP_POSTINSTALL` | `1` para omitir el despliegue del postinstall. |

---

## 7. Arquitectura

```
DSH ──MCP stdio──► server.mjs (bundle single-file)
                      ├─ lee PREFERENCIAS_WENDIGO.md al conectar
                      ├─ inyecta preferencias como server instructions
                      └─ notas jsonl + espejo markdown + audit + rate limit
```

- Servidor con `@modelcontextprotocol/server@2.2.0` (protocolo 2026-07-28) y
  `serveStdio`, la misma generación que usa DSH del otro lado.
- `cordis.patch.yml` inserta una fila de `@deepseek-ai/dsh-mcp-client`
  (`serverName: hermano`) sin rutas de máquina.
- Bundle `dist/server.mjs` generado con esbuild; `prepack` lo reconstruye antes
  de publicar y `dist/` queda commiteado para instalaciones `github:`.

---

## 8. Solución de problemas

**“A dependency's install scripts need your permission”** (pnpm 11): es el
pedido de permiso del `postinstall`. Haz clic en *Allow these scripts and retry*.
Si el cartel vuelve en bucle, revisa `<perfil>\pnpm-workspace.yaml`: las claves
de `allowBuilds` deben valer `true`, no el texto placeholder
`set this to true or false`.

**No aparecen las tools `mcp__hermano__*`**: confirma que
`<DSH_HOME>\plugins\hermano\server.mjs` existe, que la fila `mcp-hermano` está en
el patch del perfil y reinicia DSH si hace falta.

**No encuentra las preferencias**: usa `memory_config` con la ruta absoluta y
`confirm:true`, o coloca el archivo en `<DSH_HOME>\hermano\PREFERENCIAS_WENDIGO.md`.

---

## 9. Roadmap

- `memory_forget` (borrar notas por id, con confirmación).
- Compactación/duplicados de notas.
- Resumen automático de notas por proyecto.
- Soporte de múltiples archivos de preferencias (global + proyecto).
