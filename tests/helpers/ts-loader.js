/**
 * Loads a route or library file the way Next would (TypeScript compiled to CommonJS, `@/` paths),
 * with chosen modules replaced. `stubs` is keyed by project path without extension (for example
 * 'lib/mongodb') or by package name (for example 'resend'). Each call gets a fresh module cache.
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

const ROOT = path.join(__dirname, '..', '..');

function loadModule(relative, stubs = {}) {
  const byPath = {};
  const byName = {};
  for (const [key, value] of Object.entries(stubs)) {
    if (key.startsWith('lib/') || key.startsWith('pages/')) byPath[path.join(ROOT, key)] = value;
    else byName[key] = value;
  }
  const cache = new Map();
  const loadFile = (filename) => {
    if (cache.has(filename)) return cache.get(filename).exports;
    const source = fs.readFileSync(filename, 'utf8');
    const code = /\.tsx?$/.test(filename)
      ? ts.transpileModule(source, {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
        }).outputText
      : source;
    const mod = new Module(filename);
    mod.filename = filename;
    mod.paths = Module._nodeModulePaths(path.dirname(filename));
    cache.set(filename, mod);
    mod.require = (id) => {
      if (Object.prototype.hasOwnProperty.call(byName, id)) return byName[id];
      const base = id.startsWith('@/') ? path.join(ROOT, id.slice(2)) : id.startsWith('.') ? path.join(path.dirname(filename), id) : null;
      if (!base) return require(id);
      const bare = base.replace(/\.(ts|tsx|js)$/, '');
      if (byPath[bare]) return byPath[bare];
      for (const ext of ['.ts', '.tsx', '.js']) if (fs.existsSync(bare + ext)) return loadFile(bare + ext);
      return require(base);
    };
    mod._compile(code, filename);
    return mod.exports;
  };
  return loadFile(path.join(ROOT, relative));
}

/** A minimal Next API response that records what the handler sent. */
function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    getHeader(k) { return this.headers[k.toLowerCase()]; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

module.exports = { ROOT, loadModule, mockResponse };
