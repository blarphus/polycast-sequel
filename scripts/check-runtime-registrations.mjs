#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'runtime-registration-audit-secret';
process.env.EXTENSION_ORIGIN ||= 'chrome-extension://runtime-registration-audit';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUTPUT = path.join(ROOT, 'docs/runtime-registrations.json');
const { createApp } = await import('../server/app.js');

function collectRoutes(stack, output = []) {
  for (const layer of stack || []) {
    if (layer.route) {
      for (const method of Object.keys(layer.route.methods).sort()) {
        output.push({ method: method.toUpperCase(), path: String(layer.route.path) });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      collectRoutes(layer.handle.stack, output);
    }
  }
  return output;
}

const app = createApp({ clientDist: '/tmp/polycast-registration-audit-no-static-files' });
const routes = collectRoutes(app._router.stack).sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
const routeKeys = routes.filter((route) => route.path !== '*').map((route) => `${route.method} ${route.path}`);
const duplicateRoutes = routeKeys.filter((key, index) => routeKeys.indexOf(key) !== index);
if (duplicateRoutes.length) throw new Error(`Duplicate runtime routes: ${[...new Set(duplicateRoutes)].join(', ')}`);

const background = await readFile(path.join(ROOT, 'extension/background.js'), 'utf8');
const messageContract = JSON.parse(await readFile(path.join(ROOT, 'contracts/extension-messages-v1.json'), 'utf8'));
const declaredMessages = Object.keys(messageContract.messages).sort();
const handledMessages = [...background.matchAll(/case\s+'([A-Z][A-Z0-9_]+)'\s*:/g)].map((match) => match[1]).sort();
const duplicateCases = handledMessages.filter((value, index) => handledMessages.indexOf(value) !== index);
const missingHandlers = declaredMessages.filter((type) => !handledMessages.includes(type));
const missingSchemas = handledMessages.filter((type) => !declaredMessages.includes(type));
if (duplicateCases.length || missingHandlers.length || missingSchemas.length) {
  throw new Error(`Extension registration drift: duplicateCases=${duplicateCases}; missingHandlers=${missingHandlers}; missingSchemas=${missingSchemas}`);
}

const socketSources = await Promise.all([
  'server/socket/index.js', 'server/socket/groupCall.js', 'server/socket/transcription.js',
].map(async (file) => [file, await readFile(path.join(ROOT, file), 'utf8')]));
const socketRegistrations = socketSources.flatMap(([file, source]) =>
  [...source.matchAll(/(?:socket|io)\.on\(\s*['"]([^'"]+)['"]/g)].map((match) => ({ file, event: match[1] })),
).sort((a, b) => `${a.event} ${a.file}`.localeCompare(`${b.event} ${b.file}`));

const payload = {
  generatedAt: 'deterministic-from-runtime-registration',
  summary: {
    apiRoutes: routeKeys.length,
    extensionMessages: declaredMessages.length,
    socketRegistrations: socketRegistrations.length,
  },
  routes,
  extensionMessages: declaredMessages,
  socketRegistrations,
};
const serialized = `${JSON.stringify(payload, null, 2)}\n`;
if (process.argv.includes('--write')) {
  await writeFile(OUTPUT, serialized);
  console.log(`Recorded ${routeKeys.length} routes, ${declaredMessages.length} extension messages, and ${socketRegistrations.length} socket registrations`);
} else {
  const existing = await readFile(OUTPUT, 'utf8');
  if (existing !== serialized) {
    console.error('Runtime registration manifest drifted; run npm run registrations');
    process.exit(1);
  }
  console.log(`Runtime registrations are unique and current (${routeKeys.length} routes, ${declaredMessages.length} extension messages)`);
}
