const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

initializeApp();
const db = getFirestore();
const MINUTE = 60 * 1000;
// Tolerancia para no perder avisos si una ejecución del programador se retrasa u omite.
const GRACE = 10 * MINUTE;
const WINDOWS = [
  { kind: '24h', offset: 24 * 60 * MINUTE, title: 'Servicio en 24 horas' },
  { kind: '2h', offset: 2 * 60 * MINUTE, title: 'Servicio en 2 horas' }
];
// FCM exige un enlace HTTPS absoluto; por defecto se usa el dominio de Firebase Hosting.
const APP_URL = process.env.APP_URL || `https://${process.env.GCLOUD_PROJECT}.web.app/`;

// Busca servicios próximos cada minuto y envía avisos 24 h y 2 h antes.
exports.sendServiceReminders = onSchedule({
  schedule: 'every 1 minutes',
  timeZone: 'America/Mexico_City',
  region: 'us-central1'
}, async () => {
  const now = Date.now();
  const due = [];
  for (const w of WINDOWS) {
    // Solo se leen los servicios dentro de la ventana de cada aviso.
    const snap = await db.collection('quotes')
      .where('scheduledAt', '>', Timestamp.fromMillis(now + w.offset - GRACE))
      .where('scheduledAt', '<=', Timestamp.fromMillis(now + w.offset))
      .get();
    snap.docs.forEach(d => due.push({ doc: d, w }));
  }
  if (!due.length) return;

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
  if (!devices.length) return;

  for (const { doc: quoteDoc, w } of due) {
    const q = quoteDoc.data();
    // La clave incluye el instante del servicio: si cambia fecha u hora, ambos avisos se reprograman solos.
    const key = `${w.kind}@${q.scheduledAt.toMillis()}`;
    if ((q.remindersSent || []).includes(key)) continue;

    // La transacción evita que ejecuciones simultáneas dupliquen el aviso.
    let claimed = false;
    await db.runTransaction(async tx => {
      const fresh = await tx.get(quoteDoc.ref);
      if (!fresh.exists) return;
      const freshAt = fresh.get('scheduledAt');
      if (!freshAt || freshAt.toMillis() !== q.scheduledAt.toMillis()) return;
      const sent = fresh.get('remindersSent') || [];
      if (!sent.includes(key)) {
        tx.update(quoteDoc.ref, { remindersSent: [...sent, key] });
        claimed = true;
      }
    });
    if (!claimed) continue;

    const when = q.hora || 'hora no indicada';
    const title = w.title;
    const body = `${q.cliente || 'Cliente'} · ${q.tipo || 'Transporte'} · ${q.fecha || ''} ${when} · ${q.origen || ''} → ${q.destino || ''}`;
    for (let i = 0; i < devices.length; i += 500) {
      const batch = devices.slice(i, i + 500);
      const result = await getMessaging().sendEachForMulticast({
        tokens: batch.map(x => x.token),
        notification: { title, body },
        webpush: { notification: { title, body, tag: `pv-${quoteDoc.id}-${w.kind}` }, fcmOptions: { link: APP_URL } }
      });
      const removals = [];
      result.responses.forEach((r, index) => {
        const code = r.error?.code || '';
        if (!r.success && (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token'))) {
          batch[index].refs.forEach(ref => removals.push(ref.delete()));
        }
      });
      if (removals.length) await Promise.all(removals);
    }
  }
});
