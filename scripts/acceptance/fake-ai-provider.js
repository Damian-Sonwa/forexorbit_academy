/**
 * TEST DOUBLE ONLY: a local OpenAI-compatible Chat Completions server for automated tests and the
 * acceptance run, so AI lesson development can be exercised without a real provider, network
 * access or quota. It is never used by the application itself (the app talks to whatever provider
 * the server is configured for; see lib/ai-provider.js).
 *
 * Its answers are assembled from the request it receives (the topic title and media placeholders in
 * the prompt), so tests can check that the course context really reaches the provider. Scripted
 * behaviours are queued with `next(kind)`: lesson (default), checks, truncated, malformed, short,
 * quota, auth, ratelimit, unavailable, slow.
 */

const http = require('http');

function topicOf(prompt) {
  const m = /Topic \(lesson \d+ of \d+\): (.+)/.exec(prompt);
  return m ? m[1].trim() : 'this topic';
}

function lessonJson(prompt, { wrongMath = false, sectionOnly = false } = {}) {
  const topic = topicOf(prompt);
  const media = [...prompt.matchAll(/\[\[MEDIA:([a-z0-9]+)\]\]/g)].map((m) => m[1]);
  const para = (s) => `${s} In ${topic.toLowerCase()}, each idea builds on the previous one, so read the sections in order and try the example yourself before checking the answer.`;
  if (sectionOnly) {
    return { sections: [{ kind: 'example', heading: `A worked example: ${topic}`, body: para(`This example applies ${topic} to a hypothetical EUR/USD trade.`), keep: [] }], calculations: [{ afterSection: 0, label: 'Pip value of one standard lot', type: 'pip_value', inputs: { units: 100000, pipSize: 0.0001, quoteCurrency: 'USD' }, expectedResult: 10 }], knowledgeChecks: [] };
  }
  return {
    sections: [
      { kind: 'introduction', heading: 'Introduction', body: para(`This lesson explains ${topic} from the ground up.`) + '\n\n' + para('We start with the definitions you need and then move to practical use.'), keep: [] },
      { kind: 'explanation', heading: `Understanding ${topic}`, body: [para(`**${topic}** is a core idea in forex trading.`), para('Prices are quoted as the amount of quote currency needed to buy one unit of the base currency.'), '- The base currency is the first currency in the pair\n- The quote currency is the second currency in the pair'].join('\n\n'), keep: media.slice(0, 1) },
      { kind: 'example', heading: 'A worked example', body: para('Suppose a hypothetical account of 10,000 USD risks 1% on a trade with a 50-pip stop.'), keep: media.slice(1) },
      { kind: 'mistakes', heading: 'Common mistakes', body: 'Beginners often size positions by feel instead of from a fixed risk per trade, which makes losses uneven and hard to control.', keep: [] },
      { kind: 'summary', heading: 'Summary', body: para(`You have seen what ${topic} means and how it is used in a trade.`), keep: [] },
    ],
    calculations: [
      { afterSection: 2, label: 'Position size for 1% risk', type: 'position_size', inputs: { accountBalance: 10000, riskPercent: 1, stopPips: 50, pipValuePerLot: 10, accountCurrency: 'USD' }, expectedResult: wrongMath ? 2 : 0.2 },
    ],
    knowledgeChecks: [
      { question: `Which currency is the base currency in EUR/USD?`, options: ['EUR', 'USD', 'Both', 'Neither'], correctIndex: 0, explanation: 'The base currency is listed first.' },
      { question: 'What does a 1% risk per trade limit?', options: ['The loss if the stop is hit', 'The spread', 'The leverage', 'The number of trades'], correctIndex: 0, explanation: 'Risk per trade caps the loss at the stop.' },
    ],
    suggestions: [],
  };
}

function startFakeProvider(port = 0) {
  const queue = [];
  const requests = [];
  // Models this account may use (GET /v1/models) and models the provider refuses (retired).
  const models = new Set(['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'whisper-large-v3']);
  const refused = new Set();
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.method === 'GET' && /\/models$/.test(req.url)) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ object: 'list', data: [...models].map((id) => ({ id, object: 'model', active: true })) }));
      }
      let parsed = {};
      try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      const prompt = ((parsed.messages || []).find((m) => m.role === 'user') || {}).content || '';
      if (refused.has(parsed.model)) {
        requests.push({ url: req.url, model: parsed.model, refused: true, reasoning: parsed.reasoning_effort || null });
        res.writeHead(404, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: `The model "${parsed.model}" has been decommissioned and is no longer supported.`, type: 'invalid_request_error', code: 'model_decommissioned' } }));
      }
      requests.push({ reasoning: parsed.reasoning_effort || null, url: req.url, auth: req.headers.authorization || '', model: parsed.model, prompt, system: ((parsed.messages || []).find((m) => m.role === 'system') || {}).content || '' });
      const kind = queue.shift() || (/Section to write:|Task: Write practical forex examples/.test(prompt) ? 'section' : /knowledge-check questions that test/.test(prompt) ? 'checks' : 'lesson');
      const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)); };
      const answer = (content, finish = 'stop') => send(200, { id: 'fake', model: parsed.model || 'fake-model', choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content } }], usage: { prompt_tokens: Math.ceil(prompt.length / 4), completion_tokens: Math.ceil(content.length / 4) } });
      switch (kind) {
        case 'quota': return send(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } });
        case 'ratelimit': return send(429, { error: { message: 'Rate limit reached for requests', type: 'requests' } });
        case 'auth': return send(401, { error: { message: 'Invalid API key', code: 'invalid_api_key' } });
        case 'unavailable': return send(503, { error: { message: 'overloaded' } });
        case 'truncated': return answer(JSON.stringify(lessonJson(prompt)).slice(0, 400), 'length');
        case 'malformed': return answer('Here is your lesson about forex! It is great.');
        case 'short': return answer(JSON.stringify({ sections: [{ kind: 'summary', heading: 'Summary', body: 'Too short.' }] }));
        case 'wrongmath': return answer(JSON.stringify(lessonJson(prompt, { wrongMath: true })));
        case 'section': return answer(JSON.stringify(lessonJson(prompt, { sectionOnly: true })));
        case 'checks': return answer(JSON.stringify({ sections: [], knowledgeChecks: lessonJson(prompt).knowledgeChecks }));
        case 'slow': return setTimeout(() => answer(JSON.stringify(lessonJson(prompt))), 1500);
        default: return answer(JSON.stringify(lessonJson(prompt)));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({ url: `http://127.0.0.1:${actual}/v1`, requests, models, refuse: (id) => refused.add(id), next: (kind) => queue.push(kind), close: () => new Promise((r) => server.close(r)) });
    });
  });
}

module.exports = { startFakeProvider };
