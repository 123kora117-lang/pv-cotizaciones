# App de cotizaciones y recordatorios | Transportes PV Costa y Sierra

## Qué incluye
- Sincronización de cotizaciones entre dispositivos mediante Cloud Firestore.
- Edición y eliminación de cotizaciones compartidas entre usuarios del mismo proyecto.
- Cálculo automático de costo sin IVA, importe de IVA y total con IVA.
- Avisos push 24 horas y 2 horas antes de cada servicio.
- Registro por separado de cada dispositivo que activa las notificaciones.
- Cotización imprimible y opción de guardar en PDF.

## Preparación del proyecto Firebase
1. Crea un proyecto Firebase y registra una aplicación web. Conserva el objeto de configuración que aparece en Firebase.
2. Activa **Authentication > Email/Password**. Crea desde Firebase Console las cuentas del personal que podrá ver y editar las cotizaciones. La pantalla de la app no permite crear cuentas nuevas.
3. Crea Cloud Firestore.
4. Activa Firebase Cloud Messaging para Web y crea una clave Web Push (VAPID).
5. Copia el objeto `firebaseConfig` y la clave VAPID en `public/index.html`. Copia el mismo `firebaseConfig` en `public/firebase-messaging-sw.js`.
6. Instala Firebase CLI, inicia sesión y desde esta carpeta ejecuta `firebase use --add` para seleccionar el proyecto.
7. Instala dependencias de funciones: `cd functions` y `npm install`; vuelve a la carpeta principal.
8. Despliega reglas, hosting y función: `firebase deploy`.
9. Abre el sitio desplegado usando HTTPS, inicia sesión en cada dispositivo y pulsa **Activar avisos en este dispositivo** en cada uno.

La función programada usa Cloud Scheduler. Revisa los requisitos de facturación y costos vigentes de Firebase / Google Cloud antes del despliegue. Los avisos push requieren un navegador compatible, HTTPS y permiso de notificaciones. El dispositivo debe haber autorizado avisos al menos una vez.

## Archivos
- `public/index.html`: interfaz, inicio de sesión, sincronización, formulario y PDF.
- `public/firebase-messaging-sw.js`: recepción de notificaciones en segundo plano.
- `functions/index.js`: función programada para avisos de 24 h y 2 h.
- `firestore.rules`: acceso para usuarios autenticados y protección de tokens por usuario.
- `firebase.json`: configuración de Firebase Hosting, Firestore y Functions.

## Consideraciones
- Las fechas y horas se interpretan siempre en America/Mexico_City (sin horario de verano) y se guardan como instante UTC, sin importar la zona del dispositivo.
- Cada aviso se marca como enviado junto con el instante del servicio (`24h@…`, `2h@…`): no se repite, y si cambia la fecha u hora ambos avisos se reprograman automáticamente.
- Crear o editar una cotización sincroniza el cambio con todos los dispositivos con sesión iniciada.
- Los usuarios autenticados del proyecto comparten la colección. Solo crea cuentas para el personal autorizado.
- **Importante:** en Firebase Console > Authentication > Settings > User actions, desmarca *Enable create (sign-up)*. Sin esto, cualquiera con la configuración pública podría crear una cuenta mediante la API y leer las cotizaciones.
- Cloud Functions y Cloud Scheduler requieren el plan Blaze (pago por uso).
- iPhone/iPad: los avisos push solo funcionan si el sitio se agrega a la pantalla de inicio (iOS/iPadOS 16.4+) y se activa desde esa app.

## Avisos sin plan Blaze (GitHub Actions)
El proyecto usa el plan gratuito Spark. Los avisos los envía `reminders/index.js`, que GitHub Actions ejecuta cada 5 minutos (`.github/workflows/reminders.yml`).
- Ventanas: el aviso de 24 h se envía entre 24 h y 23 h antes; el de 2 h, entre 2 h y 1 h 30 min antes. El título indica el tiempo exacto que falta.
- Requiere el secreto `FIREBASE_SERVICE_ACCOUNT` en el repositorio (llave JSON de una cuenta de servicio). Esa llave nunca se sube al repositorio ni al sitio.
- GitHub puede retrasar las tareas programadas varios minutos; la ventana amplia evita perder avisos.
- Prueba local de la lógica: `cd reminders && npm install && npm test`.
- `functions/` queda como alternativa si en el futuro se activa el plan Blaze (no desplegar ambas a la vez).
