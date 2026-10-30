importScripts('https://www.gstatic.com/firebasejs/13.1.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/13.1.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:'AIzaSyD6Q6yFO0bipHVz7LH23sHpgP815PyD8pE',authDomain:'pv-costa-y-sierra-cotizaciones.firebaseapp.com',projectId:'pv-costa-y-sierra-cotizaciones',storageBucket:'pv-costa-y-sierra-cotizaciones.firebasestorage.app',messagingSenderId:'622188885232',appId:'1:622188885232:web:e2ec950bd306aa5f0dbe35'});
// Los avisos llegan con carga "notification": el SDK los muestra y abre el enlace al pulsarlos.
// No se llama showNotification aquí para no mostrar cada aviso dos veces.
const messaging=firebase.messaging();
messaging.onBackgroundMessage(()=>{});
