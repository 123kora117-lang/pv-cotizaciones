// Prueba la lógica de avisos con una base de datos simulada (sin conectarse a Firebase).
const assert = require('assert');
const { Timestamp } = require('firebase-admin/firestore');
const { run } = require('./index.js');

const MIN = 60 * 1000, H = 60 * MIN;

function fakeDb(quotes, tokens) {
  const ref = (store, id) => ({ id, store, delete: async () => { delete store[id]; } });
  const snapOf = (store, id) => ({ id, ref: ref(store, id), exists: id in store, data: () => store[id], get: k => store[id]?.[k] });
  return {
    collection: () => {
      const filters = [];
      const q = {
        where: (f, op, v) => { filters.push([op, v.toMillis()]); return q; },
        get: async () => ({
          docs: Object.keys(quotes).filter(id => filters.every(([op, v]) => {
            const t = quotes[id].scheduledAt.toMillis();
            return op === '>' ? t > v : t <= v;
          })).map(id => snapOf(quotes, id))
        })
      };
      return q;
    },
    collectionGroup: () => ({ get: async () => ({ docs: Object.keys(tokens).map(id => snapOf(tokens, id)) }) }),
    runTransaction: async fn => fn({
      get: async r => snapOf(r.store, r.id),
      update: (r, data) => Object.assign(r.store[r.id], data)
    })
  };
}

function fakeMessaging(invalid = []) {
  const calls = [];
  return {
    calls,
    sendEachForMulticast: async msg => {
      calls.push(msg);
      const responses = msg.tokens.map(t => invalid.includes(t)
        ? { success: false, error: { code: 'messaging/registration-token-not-registered' } }
        : { success: true });
      return { responses, successCount: responses.filter(r => r.success).length, failureCount: responses.filter(r => !r.success).length };
    }
  };
}

(async () => {
  const now = Date.parse('2026-10-30T15:00:00Z');
  const at = ms => Timestamp.fromMillis(ms);
  const quotes = {
    a: { cliente: 'A', scheduledAt: at(now + 24 * H - 3 * MIN), remindersSent: [] },  // toca 24 h
    b: { cliente: 'B', scheduledAt: at(now + 2 * H - 20 * MIN), remindersSent: [] },  // toca 2 h (ejecución retrasada)
    c: { cliente: 'C', scheduledAt: at(now + 10 * H), remindersSent: [] },            // nada
    d: { cliente: 'D', scheduledAt: at(now + 2 * H - 40 * MIN), remindersSent: [] }   // fuera de ventana: no se envía tarde
  };
  const tokens = {
    t1: { token: 'tok-1' },
    t2: { token: 'tok-1' },   // mismo navegador, otro usuario
    t3: { token: 'tok-viejo' }
  };
  const db = fakeDb(quotes, tokens);
  const m = fakeMessaging(['tok-viejo']);
  const log = () => {};

  assert.strictEqual(await run({ db, messaging: m, now, appUrl: 'https://x.web.app/', log }), 2);
  assert.strictEqual(m.calls.length, 2);
  assert.deepStrictEqual(m.calls[0].tokens.sort(), ['tok-1', 'tok-viejo']);
  assert.strictEqual(m.calls[0].webpush.fcmOptions.link, 'https://x.web.app/');
  assert.ok(!('t3' in tokens), 'el token inválido se elimina');
  assert.deepStrictEqual(quotes.a.remindersSent, [`24h@${quotes.a.scheduledAt.toMillis()}`]);
  assert.match(m.calls[0].notification.title, /^Servicio en 23 h 55 min$/);
  assert.match(m.calls[1].notification.title, /^Servicio en 1 h 40 min$/);

  // Segunda ejecución 5 minutos después: no repite nada.
  assert.strictEqual(await run({ db, messaging: m, now: now + 5 * MIN, appUrl: 'https://x.web.app/', log }), 0);
  assert.strictEqual(m.calls.length, 2);

  // Se cambia la hora de A: los avisos se reprograman aunque nadie limpie remindersSent.
  quotes.a.scheduledAt = at(now + 5 * MIN + 24 * H - 1 * MIN);
  assert.strictEqual(await run({ db, messaging: m, now: now + 5 * MIN, appUrl: 'https://x.web.app/', log }), 1);
  assert.strictEqual(quotes.a.remindersSent.length, 2);

  // Más tarde llega la ventana de 2 h del mismo servicio.
  const later = quotes.a.scheduledAt.toMillis() - 2 * H + 2 * MIN;
  assert.strictEqual(await run({ db, messaging: m, now: later, appUrl: 'https://x.web.app/', log }), 1);
  assert.ok(quotes.a.remindersSent.some(k => k.startsWith('2h@')));

  console.log('OK: todas las pruebas de avisos pasaron.');
})().catch(e => { console.error(e); process.exit(1); });
