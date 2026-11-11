// Prueba end-to-end de dsh-plugin-hermano con el MISMO cliente MCP que DSH
// (@modelcontextprotocol/client 2.2.0 + versionNegotiation: auto).
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const packageDir = path.resolve(import.meta.dirname, '..');
const tmpDir = path.join(packageDir, 'test', 'tmp');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });

const dshHome = path.join(tmpDir, 'dsh-home');
mkdirSync(path.join(dshHome, 'profiles'), { recursive: true });
const prefsPath = path.join(tmpDir, 'PREFERENCIAS_WENDIGO.md');
writeFileSync(prefsPath, '# Preferencias de prueba\n\n- Español neutro. Nunca voseo.\n- Tono directo y sin adulación.\n- Verificar antes de afirmar.\n', 'utf8');

async function makeClient(extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(packageDir, 'server.mjs')],
    env: {
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      PATH: process.env.PATH,
      USERPROFILE: process.env.USERPROFILE,
      HOME: process.env.HOME || process.env.USERPROFILE,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      DSH_HOME: dshHome,
      DSH_HERMANO_PREFS: prefsPath,
      ...extraEnv,
    },
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));
  const client = new Client(
    { name: 'hermano-test', version: '1.0.0' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } },
  );
  await client.connect(transport);
  return { client, transport };
}

function textOf(result) {
  return (result.content || []).filter((block) => block.type === 'text').map((block) => block.text).join('\n');
}

// ---------- cliente normal ----------
const { client, transport } = await makeClient();

const tools = await client.listTools();
console.log('tools:', tools.tools.map((tool) => tool.name).join(', '));

const instructions = typeof client.getInstructions === 'function' ? client.getInstructions() : '';
console.log('instructions include prefs:', instructions.includes('Nunca voseo'), '| length:', instructions.length);

const get = await client.callTool({ name: 'memory_get', arguments: {} });
console.log('--- memory_get ---');
console.log(textOf(get).split('\n').slice(0, 8).join('\n'));

const noConfirm = await client.callTool({ name: 'memory_save', arguments: { text: 'nota sin confirmar' } });
console.log('sin confirm isError:', noConfirm.isError === true, '|', textOf(noConfirm).slice(0, 140));

const saved = await client.callTool({ name: 'memory_save', arguments: { text: 'Preferencia: nunca usar voseo y verificar antes de afirmar.', scope: 'global', tags: ['tono', 'español'], confirm: true } });
console.log('--- memory_save ---');
console.log(textOf(saved));

const notesFile = path.join(dshHome, 'hermano', 'notas.jsonl');
console.log('notas.jsonl exists:', readFileSync(notesFile, 'utf8').trim().length > 0);

const search = await client.callTool({ name: 'memory_search', arguments: { query: 'voseo' } });
console.log('--- memory_search voseo ---');
console.log(textOf(search).split('\n').slice(0, 4).join('\n'));

const secret = await client.callTool({ name: 'memory_save', arguments: { text: 'mi api_key = sk-abcdefghijklmnopqrstuvwx123456', confirm: true } });
console.log('secreto isError:', secret.isError === true, '|', textOf(secret).slice(0, 160));

const list = await client.callTool({ name: 'memory_list', arguments: { limit: 5 } });
console.log('--- memory_list ---');
console.log(textOf(list).split('\n').slice(0, 4).join('\n'));

const config = await client.callTool({ name: 'memory_config', arguments: {} });
console.log('--- memory_config ---');
console.log(textOf(config).split('\n').slice(0, 5).join('\n'));

await client.close();
try { await transport.close?.(); } catch { /* ya cerrado */ }

// ---------- cliente read-only ----------
const { client: roClient, transport: roTransport } = await makeClient({ DSH_HERMANO_MODE: 'read-only' });
const roSave = await roClient.callTool({ name: 'memory_save', arguments: { text: 'no debería guardarse', confirm: true } });
console.log('read-only save isError:', roSave.isError === true, '|', textOf(roSave).slice(0, 140));
await roClient.close();
try { await roTransport.close?.(); } catch { /* ya cerrado */ }

console.log('OK');
