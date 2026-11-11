// dsh-plugin-hermano — postinstall.
//
// El bundle se instala en el perfil, pero la fila MCP lanza una copia estable
// en <DSH_HOME>/plugins/hermano. Este script:
//   1. copia el server bundleado y el package.json;
//   2. si no existe config, busca PREFERENCIAS_WENDIGO.md en las ubicaciones
//      habituales y deja la ruta anotada en <DSH_HOME>/hermano/config.json.
//
// Es best-effort: si no encuentra DSH_HOME, avisa y sale 0 para no romper la
// instalación del host.

import { existsSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function log(message) {
  process.stdout.write(`[dsh-plugin-hermano] ${message}\n`);
}

function findDshHome() {
  const fromEnv = process.env.DSH_HOME && process.env.DSH_HOME.trim();
  if (fromEnv) return fromEnv;

  let current = packageDir;
  for (let depth = 0; depth < 14; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
    if (path.basename(current).toLowerCase() === 'profiles') return path.dirname(current);
    current = parent;
  }

  const initCwd = process.env.INIT_CWD;
  if (initCwd && existsSync(path.join(initCwd, 'cordis.patch.yml'))) return path.dirname(initCwd);

  const fallback = path.join(homedir(), '.dsh');
  return existsSync(path.join(fallback, 'profiles')) ? fallback : null;
}

function findPreferencesFile() {
  const home = homedir();
  const candidates = [
    path.join(home, 'Desktop', 'PREFERENCIAS_WENDIGO.md'),
    path.join(home, 'OneDrive', 'Desktop', 'PREFERENCIAS_WENDIGO.md'),
    path.join(home, 'OneDrive', 'Escritorio', 'PREFERENCIAS_WENDIGO.md'),
    path.join(home, 'Desktop', 'Escritorio', 'PREFERENCIAS_WENDIGO.md'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const roots = [
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'Desktop'),
  ];
  const skip = new Set(['node_modules', '.git', '.svn', 'appdata', 'windows', '$recycle.bin']);
  const walk = (dir, depth) => {
    if (depth < 0) return null;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return null; }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === 'preferencias_wendigo.md') return path.join(dir, entry.name);
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (skip.has(entry.name.toLowerCase())) continue;
      const found = walk(path.join(dir, entry.name), depth - 1);
      if (found) return found;
    }
    return null;
  };
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const found = walk(root, 3);
    if (found) return found;
  }
  return null;
}

if (process.env.DSH_HERMANO_SKIP_POSTINSTALL === '1') {
  log('postinstall omitido (DSH_HERMANO_SKIP_POSTINSTALL=1)');
  process.exit(0);
}

const dshHome = findDshHome();
if (!dshHome) {
  log('no se encontró DSH_HOME; no se desplegó nada.');
  log('Ejecuta install.ps1 manualmente o define DSH_HOME y reinstala el paquete.');
  process.exit(0);
}

const targetDir = path.join(dshHome, 'plugins', 'hermano');
const dataDir = path.join(dshHome, 'hermano');
const configFile = path.join(dataDir, 'config.json');

try {
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });

  const files = [
    [path.join(packageDir, 'dist', 'server.mjs'), path.join(targetDir, 'server.mjs')],
    [path.join(packageDir, 'package.json'), path.join(targetDir, 'package.json')],
  ];
  let copied = 0;
  for (const [from, to] of files) {
    if (!existsSync(from)) {
      log(`aviso: falta ${path.relative(packageDir, from)} (se omite)`);
      continue;
    }
    copyFileSync(from, to);
    copied++;
  }
  log(`desplegados ${copied}/${files.length} archivos en ${targetDir}`);

  // Config inicial: ruta detectada de preferencias (sin pisar una existente).
  mkdirSync(dataDir, { recursive: true });
  let config = {};
  if (existsSync(configFile)) {
    try { config = JSON.parse(readFileSync(configFile, 'utf8')); } catch { config = {}; }
  }
  if (!config.preferencesPath) {
    const prefs = findPreferencesFile();
    if (prefs) {
      config.preferencesPath = prefs;
      config.discoveredAt = new Date().toISOString();
      writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', 'utf8');
      log(`preferencias detectadas: ${prefs}`);
    } else {
      log('no se encontró PREFERENCIAS_WENDIGO.md; puedes fijar la ruta con memory_config.');
    }
  } else {
    log(`config existente: ${config.preferencesPath}`);
  }

  log('listo. Reinicia DSH si las tools mcp__hermano__* no aparecen.');
} catch (error) {
  log(`falló el despliegue: ${error.message}`);
  log('Puedes desplegar manualmente con install.ps1.');
  process.exit(0);
}
