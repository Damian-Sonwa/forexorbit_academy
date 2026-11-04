/** Headless Microsoft Edge driven over DevTools, shared by the trading acceptance suites. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

/** A headless Edge with its own profile (a "device"), driven over DevTools. */
async function launchBrowser(port, label) {
  const WebSocket = require('ws');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), `fo-trading-edge-${label}-`));
  const proc = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let list = [];
  for (let i = 0; i < 60 && !list.length; i += 1) {
    try { list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter((t) => t.type === 'page'); } catch { await sleep(500); }
  }
  const attach = async (target) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
    await new Promise((resolve) => ws.once('open', resolve));
    let seq = 0;
    const pending = new Map();
    const listeners = new Map();
    ws.on('message', (m) => {
      const msg = JSON.parse(m);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result || { error: msg.error }); pending.delete(msg.id); return; }
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    });
    // Every DevTools call answers within 30 s, so a stuck page fails a check instead of hanging.
    const send = (method, params = {}) => new Promise((resolve) => {
      seq += 1;
      const id = seq;
      const timer = setTimeout(() => { pending.delete(id); console.log(`WARN [${label}] ${method} timed out`); resolve({ error: { message: 'timeout' } }); }, 30000);
      pending.set(id, (value) => { clearTimeout(timer); resolve(value); });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression) => ((await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result || {}).value;
    const waitFor = async (expression, timeout = 20000) => {
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        try { if (await evaluate(expression)) return true; } catch { /* navigating */ }
        await sleep(250);
      }
      return false;
    };
    const requests = [];
    listeners.set('Network.requestWillBeSent', [(p) => requests.push({ url: p.request.url, method: p.request.method })]);
    await send('Network.enable');
    await send('Page.enable');
    // Headless Edge throttles or freezes background tabs: bring a tab forward before driving it.
    const front = () => send('Page.bringToFront');
    const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
    return { ws, send, evaluate, waitFor, requests, front, on, close: () => ws.close() };
  };
  const first = await attach(list[0]);
  const newTab = async () => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    return attach(target);
  };
  const quit = async () => {
    try {
      const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      const socket = new WebSocket(webSocketDebuggerUrl, { perMessageDeflate: false });
      await new Promise((resolve) => { socket.once('open', resolve); socket.once('error', resolve); setTimeout(resolve, 5000); });
      if (socket.readyState === 1) socket.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await new Promise((resolve) => { socket.once('close', resolve); setTimeout(resolve, 5000); });
    } catch { /* gone */ }
    proc.kill();
  };
  return { first, newTab, quit };
}

module.exports = { EDGE, launchBrowser, sleep };
