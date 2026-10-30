// Envía los avisos de 24 h y 2 h antes de cada servicio.
// Lo ejecuta GitHub Actions cada 5 minutos (plan Spark, sin Cloud Functions).
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

const MINUTE = 60 * 1000;
// GitHub puede retrasar las ejecuciones programadas varios minutos: cada aviso tiene una ventana amplia
// y la marca en remindersSent impide que se repita.
const WINDOWS = [
  { kind: '24h', offset: 24 * 60 * MINUTE, grace: 60 * MINUTE },
  { kind: '2h', offset: 2 * 60 * MINUTE, grace: 30 * MINUTE }
];

function remaining(ms) {
  const total = Math.max(5, Math.round(ms / (5 * MINUTE)) * 5);
  const h = Math.floor(total / 60), m = total % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} horas` : `${m} min`;
}

async function run({ db, messaging, now = Date.now(), appUrl, log = console.log }) {
  const due = [];
  for (const w of WINDOWS) {
    const snap = await db.collection('quotes')
      .where('scheduledAt', '>', Timestamp.fromMillis(now + w.offset - w.grace))
      .where('scheduledAt', '<=', Timestamp.fromMillis(now + w.offset))
      .get();
    snap.docs.forEach(d => due.push({ doc: d, w }));
  }
  if (!due.length) { log('Sin avisos pendientes.'); return 0; }

  // Un mismo navegador puede estar registrado por varios usuarios: se envía una sola vez por token.
  const tokenSnap = await db.collectionGroup('tokens').get();
  const byToken = new Map();
  tokenSnap.docs.forEach(d => {
    const token = d.get('token');
    if (typeof token !== 'string' || !token) return;
    if (!byToken.has(token)) byToken.set(token, []);
    byToken.get(token).push(d.ref);
  });
  const devices = [...byToken.entries()].map(([token, refs]) => ({ token, refs }));
  if (!devices.length) { log('No hay dispositivos con avisos activados.'); return 0; }

  let sentCount = 0;
  for (const { doc: quoteDoc, w } of due) {
    const q = quoteDoc.data();
    const eventAt = q.scheduledAt.toMillis();
    // La clave incluye el instante del servicio: si cambia fecha u hora, ambos avisos se reprograman solos.
    const key = `${w.kind}@${eventAt}`;
    if ((q.remindersSent || []).includes(key)) continue;

    // La transacción evita que dos ejecuciones simultáneas dupliquen el aviso.
    let claimed = false;
    await db.runTransaction(async tx => {
      const fresh = await tx.get(quoteDoc.ref);
      if (!fresh.exists) return;
      const freshAt = fresh.get('scheduledAt');
      if (!freshAt || freshAt.toMillis() !== eventAt) return;
      const sent = fresh.get('remindersSent') || [];
      if (!sent.includes(key)) {
        tx.update(quoteDoc.ref, { remindersSent: [...sent, key] });
        claimed = true;
      }
    });
    if (!claimed) continue;

    const title = `Servicio en ${remaining(eventAt - now)}`;
    const body = `${q.cliente || 'Cliente'} · ${q.tipo || 'Transporte'} · ${q.fecha || ''} ${q.hora || 'hora no indicada'} · ${q.origen || ''} → ${q.destino || ''}`;
    for (let i = 0; i < devices.length; i += 500) {
      const batch = devices.slice(i, i + 500);
      const result = await messaging.sendEachForMulticast({
        tokens: batch.map(x => x.token),
        notification: { title, body },
        webpush: { notification: { title, body, tag: `pv-${quoteDoc.id}-${w.kind}` }, fcmOptions: { link: appUrl } }
      });
      const removals = [];
      result.responses.forEach((r, index) => {
        const code = r.error?.code || '';
        if (!r.success && (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token'))) {
          batch[index].refs.forEach(ref => removals.push(ref.delete()));
        }
      });
      if (removals.length) await Promise.all(removals);
      log(`Aviso ${w.kind} de ${quoteDoc.id}: ${result.successCount} enviados, ${result.failureCount} fallidos.`);
    }
    sentCount++;
  }
  return sentCount;
}

module.exports = { run, WINDOWS };

if (require.main === module) {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'pv-costa-y-sierra-cotizaciones';
  initializeApp({ credential: applicationDefault(), projectId });
  run({
    db: getFirestore(),
    messaging: getMessaging(),
    appUrl: process.env.APP_URL || `https://${projectId}.web.app/`
  }).catch(e => { console.error(e); process.exit(1); });
}
