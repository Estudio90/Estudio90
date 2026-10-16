/* MASTERLOOK · Google Analytics 4 + conversión de Google Ads, con Consent Mode v2.
 *
 * Mide LO MISMO que el Pixel de Meta (meta-consent.js), en los MISMOS puntos:
 *   seleccionar_sucursal · view_item (=ViewContent) · begin_checkout (=InitiateCheckout)
 *   ir_agendapro (=IrAAgendaPro) · reserva_confirmada (=Schedule) + conversión de Ads.
 *
 * Reglas duras (las mismas del Pixel):
 *  - CONSENTIMIENTO COMPARTIDO: la decisión vive en el aviso de cookies de
 *    meta-consent.js (clave mlMetaConsent). Antes de «Aceptar» no se descarga
 *    gtag.js, no se envía NADA a Google y no se crean sus cookies (más
 *    estricto que el modo «cookieless» de Google: cero peticiones). El
 *    consentimiento por defecto queda DENEGADO (Consent Mode v2) por si otra
 *    etiqueta llegara a existir. «Solo necesarias» / Desactivar borra las
 *    cookies de Google ya creadas.
 *  - SOLO en masterlook.cl / www.masterlook.cl. En DEV/local no carga nada,
 *    salvo prueba deliberada con ?debug_mode=true (se recuerda en la pestaña).
 *  - reserva_confirmada SOLO tras confirmación del SERVIDOR (bookingIds de
 *    crearReservaSinAnticipo, o comprobante aprobado de Webpay), una sola vez
 *    por reserva (transaction_id + registro de enviados): recargar o volver
 *    atrás no duplica nada. La conversión de Ads va en el mismo momento.
 *  - NUNCA datos personales (nombre, teléfono, correo) en ningún evento.
 *  - Falla cerrada: todo en try/catch; si Google falla o hay bloqueador, el
 *    sitio funciona igual.
 *  - UTM/gclid: se capturan SIEMPRE (dato propio de la visita, sin cookies de
 *    terceros) en sessionStorage, para adjuntarlos a la reserva en Firebase.
 */
(function () {
  'use strict';
  if (window.MLGoogle) return;

  var CFG = window.ML_MEDICION || {};
  var GA4 = String(CFG.GA4_ID || ''), ADS = String(CFG.ADS_ID || '');
  var CONVERSION = String(CFG.CONVERSION_RESERVA || '');
  var HOSTS = CFG.HOSTS_PRODUCCION || [];
  var MONEDA = CFG.MONEDA || 'CLP';
  var CLAVE_CONSENT = 'mlMetaConsent', COOKIE_CONSENT = 'ml_meta_consent';   // la MISMA decisión del aviso de meta-consent.js
  var CLAVE_ENVIADOS = 'mlGoogleEnviados', CLAVE_UTM = 'mlUtm';

  var host = ''; try { host = location.hostname; } catch (e) { return; }
  var esProduccion = HOSTS.indexOf(host) >= 0;

  /* ---------- almacenamiento tolerante ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function cookieGet(n) { try { var m = new RegExp('(?:^|; )' + n.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&') + '=([^;]*)').exec(document.cookie); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } }
  function borrarCookiesGoogle() {
    try {
      var nombres = []; (document.cookie || '').split(';').forEach(function (c) { var n = c.split('=')[0].trim(); if (/^(_ga|_ga_|_gcl_)/.test(n)) nombres.push(n); });
      var dominios = ['', location.hostname, '.' + location.hostname.replace(/^www\./, '')];
      nombres.forEach(function (n) { dominios.forEach(function (d) { try { document.cookie = n + '=; path=/; max-age=0; SameSite=Lax' + (d ? '; domain=' + d : ''); } catch (e) {} }); });
    } catch (e) {}
  }

  /* ---------- modo prueba (DEV): solo con ?debug_mode=true, recordado en la pestaña ---------- */
  var modoDebug = false;
  try {
    if (/[?&]debug_mode=true/.test(location.search)) { ssSet('mlGoogleDebug', '1'); modoDebug = true; }
    else modoDebug = ssGet('mlGoogleDebug') === '1';
  } catch (e) {}
  function habilitado() { return !!(GA4 && (esProduccion || modoDebug)); }

  /* ---------- consentimiento (la misma decisión del aviso compartido) ---------- */
  function gpcRechaza() { try { return navigator.globalPrivacyControl === true; } catch (e) { return false; } }
  function leerConsentimiento() {
    if (gpcRechaza()) return 'denied';
    var v = lsGet(CLAVE_CONSENT) || cookieGet(COOKIE_CONSENT);
    return v === 'granted' || v === 'denied' ? v : null;
  }

  /* ---------- UTM / gclid: SIEMPRE se capturan (primera parte, sin cookies) ---------- */
  (function capturarUtm() {
    try {
      var sp = new URLSearchParams(location.search);
      var u = {};
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (k) { var v = sp.get(k); if (v) u[k] = String(v).slice(0, 120); });
      var g = sp.get('gclid'); if (g) u.gclid = String(g).slice(0, 160);
      // ml_r: token OPACO de campañas de correo (hash del destinatario, jamás
      // el correo). Viaja a la reserva vía registrarOrigenReserva, como el gclid.
      var r = sp.get('ml_r'); if (r && /^[a-f0-9]{10,64}$/i.test(r)) u.ml_r = r.toLowerCase();
      if (Object.keys(u).length) ssSet(CLAVE_UTM, JSON.stringify(u));
    } catch (e) {}
  })();
  function obtenerUtm() {
    try { return JSON.parse(ssGet(CLAVE_UTM) || 'null'); } catch (e) { return null; }
  }

  /* ---------- gtag: stub + consentimiento por defecto DENEGADO (antes de cualquier etiqueta) ---------- */
  var cargado = false, cargando = false;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  if (habilitado()) {
    gtag('consent', 'default', {
      ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
      analytics_storage: 'denied', wait_for_update: 500,
    });
    gtag('js', new Date());
  }
  function activo() { return !!(habilitado() && cargado && leerConsentimiento() === 'granted'); }
  function cargarGtag() {
    try {
      if (!habilitado() || cargado || cargando) return;
      if (leerConsentimiento() !== 'granted') return;
      cargando = true;
      gtag('consent', 'update', {
        ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted',
        analytics_storage: 'granted',
      });
      var s = document.createElement('script');
      s.async = true;
      s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4);
      document.head.appendChild(s);
      gtag('config', GA4, modoDebug ? { debug_mode: true } : {});
      if (ADS) gtag('config', ADS);
      cargado = true; cargando = false;
    } catch (e) { cargando = false; }
  }
  function revocar() {
    try { if (cargado) gtag('consent', 'update', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' }); } catch (e) {}
    borrarCookiesGoogle();
  }

  /* ---------- registro y sin-duplicados (mismo patrón que el Pixel) ---------- */
  var registro = [];
  function leerEnviados() { try { return JSON.parse(lsGet(CLAVE_ENVIADOS) || '{}') || {}; } catch (e) { return {}; } }
  function yaEnviado(id) { var e = leerEnviados(); return !!e[id] || ssGet('mlGE_' + id) === '1'; }
  function marcarEnviado(id) {
    ssSet('mlGE_' + id, '1');
    var e = leerEnviados(); e[id] = Date.now();
    var k = Object.keys(e); if (k.length > 300) { k.sort(function (a, b) { return e[a] - e[b]; }).slice(0, k.length - 250).forEach(function (x) { delete e[x]; }); }
    lsSet(CLAVE_ENVIADOS, JSON.stringify(e));
  }
  function num(x) { var n = Number(x); return isFinite(n) && n >= 0 ? Math.round(n) : 0; }
  function enviar(nombre, params) {
    try {
      if (!activo()) return false;
      gtag('event', nombre, params || {});
      registro.push({ evento: nombre, params: params || {}, t: Date.now() });
      if (registro.length > 100) registro.shift();
      return true;
    } catch (e) { return false; }
  }

  /* ---------- eventos (mismos puntos que el Pixel) ---------- */
  function seleccionarSucursal(sucursal) {
    return enviar('seleccionar_sucursal', { sucursal: sucursal === 'providencia' ? 'providencia' : 'nunoa' });
  }
  function viewItemServicio(id, nombre, precio) {
    try {
      if (!activo() || !id) return false;
      var clave = 'vi_service_' + String(id);                                   // una vez por servicio y sesión (igual que ViewContent)
      if (ssGet('mlGE_' + clave) === '1') return false;
      if (enviar('view_item', { sucursal: 'nunoa', servicio: String(nombre || '').slice(0, 120), value: num(precio), currency: MONEDA })) { ssSet('mlGE_' + clave, '1'); return true; }
    } catch (e) {}
    return false;
  }
  var intento = { iniciado: false, ts: 0 };
  function beginCheckout(servicios) {
    try {
      if (!activo()) return false;
      var lista = (servicios || []).filter(function (s) { return s && s.id; });
      if (!lista.length) return false;
      if (intento.iniciado && Date.now() - intento.ts < 30 * 60 * 1000) return false;   // un solo evento por intento (30 min), como InitiateCheckout
      lista.forEach(function (s) { viewItemServicio(s.id, s.name, s.price); });          // todo begin_checkout va precedido de su view_item
      var total = lista.reduce(function (a, s) { return a + num(s.price) * Math.max(1, num(s.qty) || 1); }, 0);
      var ok = enviar('begin_checkout', {
        sucursal: 'nunoa',
        servicio: lista.map(function (s) { return String(s.name || ''); }).join(' + ').slice(0, 200),
        value: total, currency: MONEDA,
      });
      if (ok) { intento.iniciado = true; intento.ts = Date.now(); }
      return ok;
    } catch (e) { return false; }
  }
  function nuevoIntentoReserva() { intento = { iniciado: false, ts: 0 }; serviciosPendientes = null; }
  /* Mismo diferidor que el Pixel: si el servicio se eligió en la portada,
   * begin_checkout cuenta recién cuando la pantalla de reservas se abre
   * (después del selector de sucursal) -- mismos puntos, mismos números. */
  var serviciosPendientes = null;
  function reservasAbierta() { try { var e = document.getElementById('vistaReservas'); return !!(e && e.classList.contains('open')); } catch (e) { return false; } }
  function servicioElegido(servicios) {
    try {
      var lista = (servicios || []).filter(function (s) { return s && s.id; }); if (!lista.length) return;
      if (reservasAbierta()) { serviciosPendientes = null; beginCheckout(lista); }
      else serviciosPendientes = lista;
    } catch (e) {}
  }
  function observarReservas() {
    try {
      var e = document.getElementById('vistaReservas'); if (!e) return;
      new MutationObserver(function () { if (reservasAbierta() && serviciosPendientes) { var l = serviciosPendientes; serviciosPendientes = null; beginCheckout(l); } }).observe(e, { attributes: true, attributeFilter: ['class'] });
    } catch (er) {}
  }
  function checkoutDesdeChat(propuesta) {
    try {
      if (!propuesta || !propuesta.servicioId) return;
      beginCheckout([{ id: String(propuesta.servicioId), name: String(propuesta.servicioNombre || ''), price: num(propuesta.precioClp), qty: 1 }]);
    } catch (e) {}
  }
  function irAgendaPro() {
    return enviar('ir_agendapro', { sucursal: 'providencia' });                 // gtag usa sendBeacon: sobrevive a la salida del sitio
  }

  /* ---------- reserva confirmada + conversión de Ads (una sola vez por reserva) ---------- */
  function conversionAds(valor, transactionId) {
    if (!CONVERSION) return;
    enviar('conversion', { send_to: CONVERSION, value: num(valor), currency: MONEDA, transaction_id: String(transactionId) });
  }
  function reservaConfirmada(transactionId, params) {
    try {
      if (!activo() || !transactionId) return false;
      var id = 'reserva_' + String(transactionId);
      if (yaEnviado(id)) return false;
      params = params || {}; params.sucursal = 'nunoa'; params.currency = MONEDA; params.transaction_id = String(transactionId);
      if (enviar('reserva_confirmada', params)) { conversionAds(params.value, transactionId); marcarEnviado(id); return true; }
    } catch (e) {}
    return false;
  }
  /** Sin anticipo: el servidor ya confirmó (bookingIds reales de Firebase). */
  function reservaSinAnticipo(info) {
    try {
      var ids = (info && info.ids) || []; if (!ids.length) return false;
      var lista = (info.servicios || []).filter(function (s) { return s && s.id; });
      var total = lista.reduce(function (a, s) { return a + num(s.price) * Math.max(1, num(s.qty) || 1); }, 0);
      var prof = ''; try { prof = String(((info.citas || [])[0] || {}).barbero || ''); } catch (e) {}
      return reservaConfirmada(String(ids[0]), {
        servicio: lista.map(function (s) { return String(s.name || ''); }).join(' + ').slice(0, 200),
        profesional: prof.slice(0, 80) || 'cualquiera',
        value: total,
      });
    } catch (e) { return false; }
  }
  /** Con anticipo: comprobante que el SERVIDOR devolvió tras verificar el pago en Webpay. */
  var retornoPagoTs = 0;
  function marcarRetornoPago() { retornoPagoTs = Date.now(); }
  function clpDeTexto(t) { var d = String(t == null ? '' : t).replace(/[^0-9]/g, ''); var n = d ? parseInt(d, 10) : 0; return isFinite(n) ? n : 0; }
  function comprobantePintado(datos) {
    try {
      if (!datos || String(datos.tipo || '') !== 'RESERVATION_DEPOSIT') return false;        // solo reservas: productos/cursos no son esta conversión
      if (!retornoPagoTs || Date.now() - retornoPagoTs > 120000) return false;               // solo en el retorno real del pago
      var estado = String(datos.estado || '').toLowerCase();
      if (datos.estado && estado.indexOf('aprob') !== 0 && estado !== 'confirmado') return false;
      var orden = String(datos.numeroOperacion || ''); if (!orden) return false;
      return reservaConfirmada(orden, { servicio: '', profesional: '', value: clpDeTexto(datos.montoTexto), modalidad: 'con_anticipo' });
    } catch (e) { return false; }
  }

  /* ---------- reacción al aviso compartido de cookies ---------- */
  function alDecidir(v) { if (v === 'granted') cargarGtag(); else revocar(); }
  try { window.addEventListener('ml-consentimiento', function (ev) { try { alDecidir(ev.detail && ev.detail.valor); } catch (e) {} }); } catch (e) {}

  function arrancar() {
    try {
      observarReservas();
      if (habilitado() && leerConsentimiento() === 'granted') cargarGtag();
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();

  window.MLGoogle = {
    habilitado: habilitado, activo: activo,
    estado: function () { return { ga4: GA4, ads: ADS, produccion: esProduccion, debug: modoDebug, consentimiento: leerConsentimiento(), cargado: cargado, registro: registro.slice() }; },
    obtenerUtm: obtenerUtm,
    seleccionarSucursal: seleccionarSucursal, viewItemServicio: viewItemServicio,
    servicioElegido: servicioElegido, beginCheckout: beginCheckout,
    nuevoIntentoReserva: nuevoIntentoReserva, checkoutDesdeChat: checkoutDesdeChat,
    irAgendaPro: irAgendaPro, reservaSinAnticipo: reservaSinAnticipo,
    marcarRetornoPago: marcarRetornoPago, comprobantePintado: comprobantePintado,
  };
})();
