#!/usr/bin/env node
// dsh-plugin-hermano — memoria persistente para DeepSeek Harness.
//
// Al arrancar (una instancia por conexión MCP) lee PREFERENCIAS_WENDIGO.md y
// las inyecta como instrucciones del servidor, de modo que llegan solas a todas
// las sesiones. Expone además tools para consultar y guardar notas locales:
//
//   mcp__hermano__memory_get      preferencias actuales + notas recientes
//   mcp__hermano__memory_save     guarda una nota (requiere confirm:true)
//   mcp__hermano__memory_list     lista notas (por scope/tag)
//   mcp__hermano__memory_search   busca notas por texto
//   mcp__hermano__memory_config   muestra/crea la configuración de memoria
//
// Seguridad: lectura por defecto; escritura solo con confirm:true; rechazo de
// secretos; rate limit; audit.jsonl; modo read-only por variable de entorno.

import path from 'node:path';
import os from 'node:os';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  appendFileSync,
  writeFileSync,
  statSync,
} from 'node:fs';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const VERSION = '0.1.0';
const DSH_HOME = (() => {
  const fromEnv = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  if (fromEnv) return fromEnv;
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  return path.join(home, '.dsh');
})();

const BASE_DIR = path.join(DSH_HOME, 'hermano');
const NOTES_FILE = path.join(BASE_DIR, 'notas.jsonl');
const NOTES_MD = path.join(BASE_DIR, 'NOTAS_WENDIGO.md');
const CONFIG_FILE = path.join(BASE_DIR, 'config.json');
const AUDIT_FILE = path.join(DSH_HOME, 'cache', 'hermano', 'audit.jsonl');
const READ_ONLY = String(process.env.DSH_HERMANO_MODE || '').toLowerCase() === 'read-only';
const PREFERENCIAS_ENV = process.env.DSH_HERMANO_PREFS && process.env.DSH_HERMANO_PREFS.trim();
const PREF_MAX_CHARS = 14000;
const NOTE_MAX_CHARS = 4000;
const SAVE_RATE_LIMIT = 20; // por minuto
const SAVE_RATE_WINDOW_MS = 60_000;

function log(message) {
  process.stderr.write(`[hermano] ${message}\n`);
}

function ensureBaseDir() {
  mkdirSync(BASE_DIR, { recursive: true });
}

function readConfig() {
  try {
    if (!existsSync(CONFIG_FILE)) return {};
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeConfig(config) {
  ensureBaseDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function audit(entry) {
  try {
    mkdirSync(path.dirname(AUDIT_FILE), { recursive: true });
    appendFileSync(AUDIT_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {
    /* la auditoría es best-effort */
  }
}

// ------------------------------------------------------------------ preferencias
function boundedFind(dir, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.toLowerCase() === 'preferencias_wendigo.md') {
      return path.join(dir, entry.name);
    }
  }
  const skip = new Set(['node_modules', '.git', '.svn', 'appdata', 'windows', '$recycle.bin']);
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (skip.has(entry.name.toLowerCase())) continue;
    const found = boundedFind(path.join(dir, entry.name), depth - 1);
    if (found) return found;
  }
  return null;
}

function discoverPreferencesPath() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const candidates = [];
  if (PREFERENCIAS_ENV) candidates.push(PREFERENCIAS_ENV);
  const config = readConfig();
  if (config.preferencesPath) candidates.push(config.preferencesPath);
  candidates.push(
    path.join(BASE_DIR, 'PREFERENCIAS_WENDIGO.md'),
    path.join(home, 'Desktop', 'PREFERENCIAS_WENDIGO.md'),
    path.join(home, 'OneDrive', 'Desktop', 'PREFERENCIAS_WENDIGO.md'),
    path.join(home, 'OneDrive', 'Escritorio', 'PREFERENCIAS_WENDIGO.md'),
  );
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* ignora rutas inválidas */
    }
  }
  const roots = [path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Desktop')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const found = boundedFind(root, 3);
    if (found) {
      try {
        const config2 = readConfig();
        if (config2.preferencesPath !== found) {
          config2.preferencesPath = found;
          config2.discoveredAt = new Date().toISOString();
          writeConfig(config2);
          log(`preferencias descubiertas en ${found}`);
        }
      } catch {
        /* cachear es opcional */
      }
      return found;
    }
  }
  return null;
}

function loadPreferences() {
  const prefsPath = discoverPreferencesPath();
  if (!prefsPath) return { path: null, content: '', mtime: null, bytes: 0 };
  try {
    const content = readFileSync(prefsPath, 'utf8').replace(/^\uFEFF/, '');
    let mtime = null;
    try {
      mtime = statSync(prefsPath).mtime.toISOString();
    } catch {
      mtime = null;
    }
    return { path: prefsPath, content, mtime, bytes: content.length };
  } catch (error) {
    log(`no se pudo leer ${prefsPath}: ${error.message}`);
    return { path: prefsPath, content: '', mtime: null, bytes: 0, error: error.message };
  }
}

function preferencesUpdatedLine(content) {
  const match = content.match(/Última actualización:\s*(.+)/i);
  return match ? match[1].trim() : null;
}

// ------------------------------------------------------------------ notas
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function loadNotes() {
  if (!existsSync(NOTES_FILE)) return [];
  const notes = [];
  let raw;
  try {
    raw = readFileSync(NOTES_FILE, 'utf8');
  } catch {
    return [];
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const note = JSON.parse(trimmed);
      if (note && typeof note.text === 'string') notes.push(note);
    } catch {
      /* línea corrupta: se omite */
    }
  }
  return notes;
}

const SECRET_PATTERNS = [
  { label: 'credencial', re: /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/ },
  { label: 'contraseña o token', re: /(api[_-]?key|secret[_-]?key|password|passwd|contrase(?:n|ñ)a|bearer|access[_-]?token)\s*[:=]\s*\S{4,}/i },
  { label: 'contraseña o token', re: /(?:^|\s)(?:token|password|contrase(?:n|ñ)a)\s+\S{8,}/i },
];

function findSecrets(text) {
  const found = [];
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) found.push(pattern.label);
  }
  return [...new Set(found)];
}

function newNoteId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6);
  return `n-${stamp}-${random}`;
}

function appendNote(note) {
  ensureBaseDir();
  appendFileSync(NOTES_FILE, JSON.stringify(note) + '\n', 'utf8');
  rebuildNotesMarkdown();
}

function rebuildNotesMarkdown() {
  const notes = loadNotes();
  const prefs = loadPreferences();
  const lines = [];
  lines.push('# NOTAS_WENDIGO');
  lines.push('');
  lines.push('Espejo legible de las notas guardadas por `dsh-plugin-hermano`.');
  lines.push('');
  lines.push(`- Archivo de datos: \`${NOTES_FILE}\``);
  lines.push(`- Preferencias: ${prefs.path ? `\`${prefs.path}\`` : 'no encontradas'}`);
  lines.push(`- Notas: ${notes.length}`);
  lines.push('');
  lines.push('## Notas');
  lines.push('');
  if (notes.length === 0) {
    lines.push('_(sin notas todavía)_');
  } else {
    for (const note of notes.slice().reverse()) {
      const tags = Array.isArray(note.tags) && note.tags.length > 0 ? ` · tags: ${note.tags.join(', ')}` : '';
      lines.push(`### ${note.id} — ${note.date} · ${note.scope}${tags}`);
      lines.push('');
      lines.push(note.text);
      lines.push('');
    }
  }
  lines.push('');
  try {
    writeFileSync(NOTES_MD, lines.join('\n'), 'utf8');
  } catch (error) {
    log(`no se pudo escribir ${NOTES_MD}: ${error.message}`);
  }
}

// rate limit simple para escrituras
const saveTimestamps = [];

function checkSaveRate() {
  const now = Date.now();
  while (saveTimestamps.length > 0 && now - saveTimestamps[0] > SAVE_RATE_WINDOW_MS) {
    saveTimestamps.shift();
  }
  if (saveTimestamps.length >= SAVE_RATE_LIMIT) {
    throw new Error(`límite de escritura alcanzado (${SAVE_RATE_LIMIT} notas por minuto); espera un momento`);
  }
  saveTimestamps.push(now);
}

// ------------------------------------------------------------------ instrucciones
function buildInstructions(prefs, notes) {
  const lines = [];
  lines.push('Eres "Hermano", la memoria persistente de WENDIGO para DeepSeek Harness.');
  lines.push('');
  if (prefs.path && prefs.content.trim()) {
    const updated = preferencesUpdatedLine(prefs.content);
    lines.push(`Preferencias cargadas desde ${prefs.path}${updated ? ` (última actualización: ${updated})` : ''}:`);
    lines.push('');
    lines.push('--- inicio de preferencias ---');
    lines.push(prefs.content.slice(0, PREF_MAX_CHARS).trim());
    if (prefs.content.length > PREF_MAX_CHARS) {
      lines.push('[...preferencias truncadas; usa memory_get para el texto completo...]');
    }
    lines.push('--- fin de preferencias ---');
  } else if (prefs.path) {
    lines.push(`El archivo de preferencias existe en ${prefs.path} pero no se pudo leer${prefs.error ? `: ${prefs.error}` : '.'}`);
  } else {
    lines.push(`No se encontró PREFERENCIAS_WENDIGO.md. Pide al usuario la ruta con memory_config (por ejemplo, "C:\\...\\PREFERENCIAS_WENDIGO.md") o que coloque el archivo en ${path.join(BASE_DIR, 'PREFERENCIAS_WENDIGO.md')}.`);
  }
  lines.push('');
  lines.push(`Notas guardadas: ${notes.length}. Datos en ${NOTES_FILE}.`);
  lines.push('');
  lines.push('Reglas:');
  lines.push('1. Aplica estas preferencias (idioma, trato, forma de trabajar) en toda la conversación.');
  lines.push('2. Cuando el usuario pida recordar algo, llama a memory_save con confirm:true SOLO después de que el usuario lo confirme explícitamente.');
  lines.push('3. Nunca guardes contraseñas, tokens, claves API ni DMs; memory_save los rechaza.');
  lines.push('4. Consulta memory_search o memory_list para recuperar notas previas antes de preguntar de nuevo.');
  lines.push('5. ' + (READ_ONLY
    ? 'Este servidor está en modo read-only: no se pueden guardar notas.'
    : 'Puedes guardar notas con memory_save siempre que el usuario lo confirme.'));
  return lines.join('\n');
}

// ------------------------------------------------------------------ MCP
function buildServer() {
  const prefs = loadPreferences();
  const notes = loadNotes();
  const instructions = buildInstructions(prefs, notes);

  const server = new McpServer(
    { name: 'dsh-plugin-hermano', version: VERSION },
    { capabilities: { tools: {} }, instructions },
  );

  server.registerTool(
    'memory_get',
    {
      title: 'Ver preferencias y notas',
      description: 'Devuelve las preferencias de WENDIGO (texto completo del archivo) y un resumen de las notas guardadas. Útil para recordar el contexto al empezar una tarea.',
      inputSchema: z.object({
        includeNotes: z.boolean().optional().describe('Incluir las notas guardadas (default true).'),
        notesLimit: z.number().int().min(0).max(100).optional().describe('Máximo de notas a incluir (default 10).'),
      }),
    },
    async (args) => {
      const currentPrefs = loadPreferences();
      const currentNotes = loadNotes();
      const limit = args.notesLimit ?? 10;
      const lines = [];
      if (currentPrefs.path) {
        lines.push(`Preferencias: ${currentPrefs.path} (${currentPrefs.bytes} caracteres)`);
        lines.push('');
        lines.push(currentPrefs.content.slice(0, 20000).trim());
      } else {
        lines.push('No se encontró archivo de preferencias. Usa memory_config para fijar la ruta.');
      }
      if (args.includeNotes !== false) {
        lines.push('');
        lines.push(`Notas (${currentNotes.length} en total, mostrando ${Math.min(limit, currentNotes.length)} más recientes):`);
        if (currentNotes.length === 0) {
          lines.push('(sin notas todavía)');
        } else {
          for (const note of currentNotes.slice(-limit).reverse()) {
            lines.push(`- ${note.id} · ${note.date} · ${note.scope}${note.tags?.length ? ` · ${note.tags.join(', ')}` : ''}: ${note.text.slice(0, 300)}`);
          }
        }
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'memory_save',
    {
      title: 'Guardar una nota',
      description: 'Guarda una nota local persistente (preferencias, proyecto o tono). Requiere confirm:true y que el usuario haya confirmado. Rechaza secretos y DMs.',
      inputSchema: z.object({
        text: z.string().min(1).max(NOTE_MAX_CHARS).describe('Contenido de la nota.'),
        scope: z.enum(['global', 'wendigo', 'project']).optional().describe('Alcance de la nota (default global).'),
        tags: z.array(z.string().max(32)).max(10).optional().describe('Etiquetas para filtrar/buscar.'),
        confirm: z.literal(true).describe('Confirmación explícita: true solo si el usuario pidió recordar algo.'),
      }),
    },
    async (args) => {
      if (READ_ONLY) throw new Error('el plugin está en modo read-only (DSH_HERMANO_MODE=read-only); no se guardan notas');
      if (args.confirm !== true) throw new Error('memory_save requiere confirm:true y la confirmación del usuario');
      const text = String(args.text || '').trim();
      if (text.length === 0) throw new Error('la nota está vacía');
      const secrets = findSecrets(text);
      if (secrets.length > 0) {
        throw new Error(`no guardo secretos (${secrets.join(', ')}); reformula la nota sin contraseñas, tokens ni claves API`);
      }
      checkSaveRate();
      const note = {
        id: newNoteId(),
        date: new Date().toISOString(),
        scope: args.scope || 'global',
        tags: (args.tags || []).map((tag) => String(tag).trim()).filter(Boolean),
        text,
      };
      appendNote(note);
      audit({ tool: 'memory_save', id: note.id, scope: note.scope, tags: note.tags, length: text.length, ok: true });
      return { content: [{ type: 'text', text: `Nota guardada: ${note.id} · ${note.scope}${note.tags.length ? ` · ${note.tags.join(', ')}` : ''}.\nDatos: ${NOTES_FILE}` }] };
    },
  );

  server.registerTool(
    'memory_list',
    {
      title: 'Listar notas',
      description: 'Lista las notas guardadas, opcionalmente filtradas por alcance (scope) o etiqueta.',
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional().describe('Máximo de notas (default 20).'),
        scope: z.enum(['global', 'wendigo', 'project']).optional(),
        tag: z.string().optional(),
      }),
    },
    async (args) => {
      let notes = loadNotes();
      if (args.scope) notes = notes.filter((note) => note.scope === args.scope);
      if (args.tag) notes = notes.filter((note) => Array.isArray(note.tags) && note.tags.some((tag) => normalizeText(tag) === normalizeText(args.tag)));
      const limit = args.limit ?? 20;
      const chosen = notes.slice(-limit).reverse();
      const lines = [`Notas: ${notes.length}${args.scope ? ` (scope ${args.scope})` : ''}. Mostrando ${chosen.length}.`];
      for (const note of chosen) {
        lines.push(`- ${note.id} · ${note.date} · ${note.scope}${note.tags?.length ? ` · ${note.tags.join(', ')}` : ''}: ${note.text}`);
      }
      if (chosen.length === 0) lines.push('(sin notas que coincidan)');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'memory_search',
    {
      title: 'Buscar en la memoria',
      description: 'Busca notas por texto (sin distinguir mayúsculas ni acentos) y devuelve las coincidencias.',
      inputSchema: z.object({
        query: z.string().min(2).max(200),
        limit: z.number().int().min(1).max(50).optional().describe('Máximo de coincidencias (default 10).'),
      }),
    },
    async (args) => {
      const needle = normalizeText(args.query);
      const matches = loadNotes().filter((note) => {
        const haystack = normalizeText(`${note.text} ${(note.tags || []).join(' ')} ${note.scope}`);
        return haystack.includes(needle);
      });
      const limit = args.limit ?? 10;
      const lines = [`Coincidencias para "${args.query}": ${matches.length}.`];
      for (const note of matches.slice(-limit).reverse()) {
        lines.push(`- ${note.id} · ${note.date} · ${note.scope}${note.tags?.length ? ` · ${note.tags.join(', ')}` : ''}: ${note.text}`);
      }
      if (matches.length === 0) lines.push('(ninguna nota coincide)');
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'memory_config',
    {
      title: 'Configurar la memoria',
      description: 'Muestra la configuración actual (ruta de preferencias, directorio de notas, modo). Con preferencesPath + confirm:true fija una nueva ruta al archivo de preferencias.',
      inputSchema: z.object({
        preferencesPath: z.string().min(3).max(500).optional().describe('Ruta absoluta a PREFERENCIAS_WENDIGO.md.'),
        confirm: z.boolean().optional().describe('Para cambiar la ruta se requiere confirm:true.'),
      }),
    },
    async (args) => {
      if (args.preferencesPath) {
        if (READ_ONLY) throw new Error('modo read-only: no se puede cambiar la configuración');
        if (args.confirm !== true) throw new Error('para cambiar la ruta de preferencias se requiere confirm:true (el usuario debe confirmarlo)');
        const resolved = path.resolve(args.preferencesPath);
        if (!existsSync(resolved)) throw new Error(`no existe el archivo: ${resolved}`);
        const config = readConfig();
        config.preferencesPath = resolved;
        config.updatedAt = new Date().toISOString();
        writeConfig(config);
        audit({ tool: 'memory_config', preferencesPath: resolved, ok: true });
        const prefs = loadPreferences();
        return { content: [{ type: 'text', text: `Ruta de preferencias actualizada: ${resolved} (${prefs.bytes} caracteres leídos). Reinicia la conexión o abre una sesión nueva para que las instrucciones se recarguen.` }] };
      }
      const prefs = loadPreferences();
      const config = readConfig();
      const lines = [];
      lines.push(`Modo: ${READ_ONLY ? 'read-only' : 'normal (escritura con confirmación)'}`);
      lines.push(`DSH_HOME: ${DSH_HOME}`);
      lines.push(`Preferencias: ${prefs.path || 'no encontradas'} (${prefs.bytes} caracteres)`);
      if (prefs.mtime) lines.push(`Actualizado: ${preferencesUpdatedLine(prefs.content) || prefs.mtime}`);
      lines.push(`Notas: ${NOTES_FILE}`);
      lines.push(`Espejo legible: ${NOTES_MD}`);
      lines.push(`Auditoría: ${AUDIT_FILE}`);
      lines.push(`Config: ${CONFIG_FILE}`);
      if (config.discoveredAt) lines.push(`Ruta descubierta automáticamente el ${config.discoveredAt}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  return server;
}

ensureBaseDir();
const initialPrefs = loadPreferences();
log(`preferencias: ${initialPrefs.path || 'no encontradas'} (${initialPrefs.bytes} caracteres)`);
log(`modo: ${READ_ONLY ? 'read-only' : 'normal'}`);

serveStdio(buildServer, {
  onerror: (error) => log(`serveStdio: ${error.message}`),
});

process.on('uncaughtException', (error) => {
  log(`excepción no atrapada: ${error.message}`);
});
process.on('unhandledRejection', (error) => {
  log(`rechazo no manejado: ${error && error.message ? error.message : String(error)}`);
});
