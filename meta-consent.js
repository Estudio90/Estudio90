/* MASTERLOOK · Meta Pixel (FASE 1: solo navegador) + aviso de consentimiento.
 *
 * Qué hace: mide con el Pixel oficial de Meta («Barbería máster look») lo que pasa en masterlook.cl para optimizar los anuncios de Facebook e Instagram:
 *   PageView · ViewContent · InitiateCheckout · Schedule · Purchase  (y un evento propio, IrAAgendaPro, para Providencia).
 * Qué NO hace: no toca reservas, pagos, carrito ni cuentas; no lee ni envía nombre, correo ni teléfono; no manda el código de referido (?rf=); no usa la «configuración automática» de Meta.
 *
 * Reglas duras:
 *  - CONSENTIMIENTO: antes de aceptar no se descarga el Pixel, no se envía nada a Meta y no se crean sus cookies. Rechazar = cero seguimiento. «Preferencias de privacidad» (pie) lo cambia cuando quiera.
 *  - SOLO el Pixel oficial en masterlook.cl / www.masterlook.cl. En cualquier otro sitio (pruebas, DEV, local) NO se carga ningún Pixel salvo que se pida a propósito con ?metaPixelPrueba=<ID>.
 *  - Purchase solo con pago CONFIRMADO por el servidor (el comprobante que devuelve el servidor tras Webpay / Mercado Pago), por lo realmente cobrado en CLP. Una reserva sin anticipo es Schedule, NUNCA Purchase.
 *  - Sin duplicados: cada Schedule/Purchase tiene un identificador propio (schedule_<n.º de operación> / purchase_<n.º de operación>) y se recuerda cuáles ya se enviaron (recargar o volver de Webpay no los repite).
 *  - Falla cerrada: si algo no está claro (URL con datos privados, almacenamiento bloqueado) no se envía nada. Todo va en try/catch: si Meta falla o hay un bloqueador, el sitio funciona igual.
 *  - Providencia sale a AgendaPro: NUNCA se registra una reserva confirmada por pulsar ese enlace (solo el evento propio IrAAgendaPro, que mide intención, no conversión).
 */
(function () {
  'use strict';
  if (window.MLMeta) return;

  /* ---------- configuración ---------- */
  var PIXEL_PRODUCCION = '7476770919066641';                       // Pixel oficial «Barbería máster look» (el ID del Pixel no es secreto)
  var HOSTS_PRODUCCION = ['masterlook.cl', 'www.masterlook.cl'];
  var MONEDA = 'CLP';
  var SUCURSAL_PROPIA = 'Ñuñoa';                                   // agenda propia del sitio
  var SUCURSAL_EXTERNA = 'Providencia';                            // sale a AgendaPro
  var CLAVE_CONSENT = 'mlMetaConsent', COOKIE_CONSENT = 'ml_meta_consent', DIAS_CONSENT = 180;
  var CLAVE_ENVIADOS = 'mlMetaEnviados';
  var PARAMS_PRIVADOS = ['token', 't', 'orden', 'ref', 'pago', 'provider', 'payment_id', 'collection_id', 'status', 'external_reference', 'preference_id', 'merchant_order_id', 'resena', 'nombre', 'bookingId', 'reagendar', 'estado'];

  var host = ''; try { host = location.hostname; } catch (e) { return; }
  var esProduccion = HOSTS_PRODUCCION.indexOf(host) >= 0;
  var fbclidMemoria = '';
  try { var m0 = /[?&]fbclid=([^&#]+)/.exec(location.search); if (m0) fbclidMemoria = m0[1]; } catch (e) {}

  var pixelId = '';
  if (esProduccion) pixelId = PIXEL_PRODUCCION;
  else {
    try {                                                           // solo para pruebas: ?metaPixelPrueba=<ID> (se recuerda en la pestaña); NUNCA en masterlook.cl
      var mp = /[?&]metaPixelPrueba=(\d{10,20})/.exec(location.search);
      if (mp) { try { sessionStorage.setItem('mlMetaPixelPrueba', mp[1]); } catch (e) {} pixelId = mp[1]; }
      else { try { pixelId = sessionStorage.getItem('mlMetaPixelPrueba') || ''; } catch (e) {} }
      if (!/^\d{10,20}$/.test(pixelId)) pixelId = '';
    } catch (e) { pixelId = ''; }
  }

  /* ---------- almacenamiento tolerante (los navegadores integrados de Instagram / WhatsApp no persisten localStorage) ---------- */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function cookieGet(n) { try { var m = new RegExp('(?:^|; )' + n.replace(/[.$?*|{}()\[\]\\\/+^]/g, '\\$&') + '=([^;]*)').exec(document.cookie); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } }
  function cookieSet(n, v, dias, dominio) {
    try {
      var s = n + '=' + encodeURIComponent(v) + '; path=/; max-age=' + Math.round(dias * 86400) + '; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : '') + (dominio ? '; domain=' + dominio : '');
      document.cookie = s;
    } catch (e) {}
  }
  function cookieBorrar(n) {
    var dominios = ['', location.hostname, '.' + location.hostname.replace(/^www\./, '')];
    dominios.forEach(function (d) { try { document.cookie = n + '=; path=/; max-age=0; SameSite=Lax' + (d ? '; domain=' + d : ''); } catch (e) {} });
  }

  /* ---------- consentimiento ---------- */
  function gpcRechaza() { try { return navigator.globalPrivacyControl === true; } catch (e) { return false; } }
  function leerConsentimiento() {
    if (gpcRechaza()) return 'denied';                              // «Global Privacy Control» = rechazo automático
    var v = lsGet(CLAVE_CONSENT) || cookieGet(COOKIE_CONSENT);
    return v === 'granted' || v === 'denied' ? v : null;
  }
  function guardarConsentimiento(v) { lsSet(CLAVE_CONSENT, v); cookieSet(COOKIE_CONSENT, v, DIAS_CONSENT); }

  /* ---------- estado y registro (el registro solo guarda nombre/id/valor de cada evento: sirve para las pruebas) ---------- */
  var cargado = false, cargando = false, inicializado = false, bloqueadoPorUrl = false;
  var registro = [];
  function activo() { return !!(pixelId && inicializado && leerConsentimiento() === 'granted' && typeof window.fbq === 'function'); }

  /* ---------- enviados (sin duplicados) ---------- */
  function leerEnviados() { try { return JSON.parse(lsGet(CLAVE_ENVIADOS) || '{}') || {}; } catch (e) { return {}; } }
  function yaEnviado(id) { var e = leerEnviados(); return !!e[id] || ssGet('mlMetaE_' + id) === '1'; }
  function marcarEnviado(id) {
    ssSet('mlMetaE_' + id, '1');
    var e = leerEnviados(); e[id] = Date.now();
    var claves = Object.keys(e); if (claves.length > 300) { claves.sort(function (a, b) { return e[a] - e[b]; }).slice(0, claves.length - 250).forEach(function (k) { delete e[k]; }); }
    lsSet(CLAVE_ENVIADOS, JSON.stringify(e));
  }
  function aleatorio() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  /* ---------- URL limpia: nada privado hacia Meta ---------- */
  function paramPrivadoPresente() {                                  // la dirección todavía trae datos privados (token de pago, n.º de orden, enlaces de reagendar…): el Pixel espera a que el sitio la limpie
    try {
      var sp = new URLSearchParams(location.search);
      for (var i = 0; i < PARAMS_PRIVADOS.length; i++) if (sp.has(PARAMS_PRIVADOS[i])) return true;
    } catch (e) { return true; }
    return false;
  }
  function pantallaConHashPrivado() { try { return /^#(comprobante=|reagendar|ticket)/.test(location.hash); } catch (e) { return true; } }   // el comprobante vive en #comprobante=<n.º de operación>: ahí no se cuenta PageView (el n.º de operación sí viaja como order_id del Purchase)
  /** Quita SOLO `rf` de la barra (texto por texto: fbclid y el resto quedan idénticos). Solo si el sitio ya guardó el referido. */
  function limpiarRf() {
    try {
      if (!/[?&]rf=/.test(location.search)) return true;
      var g = JSON.parse(lsGet('mlReferidoCodigo') || 'null'); var m = /[?&]rf=([^&#]*)/.exec(location.search);
      if (!g || !m || String(g.codigo || '').toUpperCase() !== decodeURIComponent(m[1]).trim().toUpperCase()) return false;   // todavía no se guardó: no se toca nada
      var q = location.search.replace(/^\?/, '').split('&').filter(function (p) { return !/^rf=/.test(p); }).join('&');
      history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
      return true;
    } catch (e) { return false; }
  }
  function urlLista() { return limpiarRf() && !paramPrivadoPresente(); }

  /* ---------- carga del Pixel (solo tras aceptar) ---------- */
  function cargarPixel(listo) {
    if (!pixelId || cargado) { if (listo) listo(); return; }
    if (cargando) return; cargando = true;
    var intentos = 0;
    (function esperarUrl() {
      if (leerConsentimiento() !== 'granted') { cargando = false; return; }
      if (!urlLista()) { if (++intentos < 30) return setTimeout(esperarUrl, 200); bloqueadoPorUrl = true; cargando = false; return; }   // falla cerrada: la URL sigue con datos privados
      try {
        if (fbclidMemoria && !cookieGet('_fbc')) { var dom = esProduccion ? '.masterlook.cl' : ''; cookieSet('_fbc', 'fb.1.' + Date.now() + '.' + fbclidMemoria, 90, dom); }
        (function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
        window.fbq.disablePushState = true;                          // el cambio de pantallas lo cuenta el sitio (una vez por pantalla), no el Pixel
        window.fbq.allowDuplicatePageViews = true;
        window.fbq('set', 'autoConfig', false, pixelId);             // sin «configuración automática» (no lee formularios, botones ni datos del cliente)
        window.fbq('init', pixelId);
        cargado = true; inicializado = true;
      } catch (e) { cargado = false; inicializado = false; }
      cargando = false;
      if (inicializado && listo) listo();
    })();
  }
  function revocarPixel() {
    try { if (typeof window.fbq === 'function') window.fbq('consent', 'revoke'); } catch (e) {}
    inicializado = false; ['_fbp', '_fbc'].forEach(cookieBorrar);
  }

  /* ---------- envío ---------- */
  function enviar(nombre, params, eventID, personalizado) {
    try {
      if (!activo()) return false;
      var opts = eventID ? { eventID: eventID } : undefined;
      if (personalizado) window.fbq('trackCustom', nombre, params || {}, opts); else window.fbq('track', nombre, params || {}, opts);
      registro.push({ evento: nombre, id: eventID || null, params: params || {}, t: Date.now() });
      if (registro.length > 100) registro.shift();
      return true;
    } catch (e) { return false; }
  }
  function enviarUnico(nombre, params, eventID, personalizado) {      // Schedule / Purchase: una sola vez por operación, aunque se recargue o se vuelva atrás
    try {
      if (!activo() || yaEnviado(eventID)) return false;
      if (enviar(nombre, params, eventID, personalizado)) { marcarEnviado(eventID); return true; }
    } catch (e) {}
    return false;
  }

  /* ---------- PageView: una vez por pantalla pública ---------- */
  var ultimaPantalla = null, ultimaPantallaTs = 0, pvTimer = null;
  function pantallaActual() {
    try {
      var abierta = function (id) { var e = document.getElementById(id); return !!(e && e.classList.contains('open')); };
      if (abierta('vistaMisCursos') || abierta('vistaMisProductos') || abierta('vistaComprobante') || abierta('vistaComprobanteReserva')) return 'privada';
      if (paramPrivadoPresente() || pantallaConHashPrivado()) return 'privada';
      if (abierta('vistaReservas')) return 'reservas';
      if (abierta('vistaTienda')) return 'tienda';
      if (abierta('vistaAcademia')) return 'academia';
      return 'inicio';
    } catch (e) { return 'privada'; }
  }
  var RUTAS = { inicio: '', reservas: '#reservas', tienda: '#tienda', academia: '#academia' };
  function sincronizarPantalla(forzar) {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(function () {
      try {
        if (!activo()) { if (pixelId && leerConsentimiento() === 'granted' && !cargado && !cargando && pantallaActual() !== 'privada') cargarPixel(function () { ultimaPantalla = null; sincronizarPantalla(true); }); return; }
        var p = pantallaActual();
        if (p === 'privada') { ultimaPantalla = 'privada'; return; }
        if (!forzar && p === ultimaPantalla) return;
        if (p === ultimaPantalla && Date.now() - ultimaPantallaTs < 1500) return;
        ultimaPantalla = p; ultimaPantallaTs = Date.now();
        enviar('PageView', {}, 'pv_' + aleatorio());
      } catch (e) {}
    }, 150);
  }
  function observarPantallas() {
    try {
      var mo = new MutationObserver(function () { sincronizarPantalla(false); });
      ['vistaReservas', 'vistaTienda', 'vistaAcademia', 'vistaMisCursos', 'vistaMisProductos', 'vistaComprobante', 'vistaComprobanteReserva'].forEach(function (id) { var e = document.getElementById(id); if (e) mo.observe(e, { attributes: true, attributeFilter: ['class'] }); });
      window.addEventListener('popstate', function () { setTimeout(function () { sincronizarPantalla(false); }, 200); });
      window.addEventListener('hashchange', function () { setTimeout(function () { sincronizarPantalla(false); }, 200); });
    } catch (e) {}
  }

  /* ---------- contenido ---------- */
  function num(x) { var n = Number(x); return isFinite(n) && n >= 0 ? Math.round(n) : 0; }
  var CAT = { Servicio: 'service_', Producto: 'product_', Curso: 'course_' };
  function idContenido(categoria, id) { return (CAT[categoria] || 'item_') + String(id); }
  function viewContent(categoria, id, nombre, precio, extra) {
    try {
      if (!activo() || !id) return false;
      var clave = 'vc_' + idContenido(categoria, id); if (ssGet('mlMetaE_' + clave) === '1') return false;   // una vez por contenido y sesión
      var p = { content_type: 'product', content_ids: [idContenido(categoria, id)], content_name: String(nombre || '').slice(0, 120), content_category: categoria, value: num(precio), currency: MONEDA };
      if (extra) for (var k in extra) p[k] = extra[k];
      if (enviar('ViewContent', p, 'vc_' + aleatorio())) { ssSet('mlMetaE_' + clave, '1'); return true; }
    } catch (e) {}
    return false;
  }

  /* ---------- reserva: InitiateCheckout en el primer servicio realmente elegido con la pantalla de reservas abierta ---------- */
  var intento = { iniciado: false, ts: 0 }, serviciosPendientes = null;
  function reservasAbierta() { try { var e = document.getElementById('vistaReservas'); return !!(e && e.classList.contains('open')); } catch (e) { return false; } }
  function listaServicios(servicios) {
    return (servicios || []).filter(function (s) { return s && s.id; }).map(function (s) { return { id: String(s.id), nombre: String(s.name || ''), precio: num(s.price), qty: Math.max(1, num(s.qty) || 1) }; });
  }
  function paramsServicios(lista, extra) {
    var total = lista.reduce(function (a, s) { return a + s.precio * s.qty; }, 0), n = lista.reduce(function (a, s) { return a + s.qty; }, 0);
    var p = { content_type: 'product', content_ids: lista.map(function (s) { return idContenido('Servicio', s.id); }), content_name: lista.map(function (s) { return s.nombre; }).join(' + ').slice(0, 200), content_category: 'Servicio', num_items: n, sucursal: SUCURSAL_PROPIA };
    if (extra) for (var k in extra) p[k] = extra[k];
    return { p: p, total: total };
  }
  function iniciarReserva(lista) {
    if (!lista.length || !activo()) return;
    if (intento.iniciado && Date.now() - intento.ts < 30 * 60 * 1000) return;     // un solo evento por intento (30 min)
    var r = paramsServicios(lista); r.p.value = r.total; r.p.currency = MONEDA;
    lista.forEach(function (s) { viewContent('Servicio', s.id, s.nombre, s.precio, { sucursal: SUCURSAL_PROPIA }); });   // todo InitiateCheckout va precedido de su ViewContent
    if (enviar('InitiateCheckout', r.p, 'ic_' + aleatorio())) { intento.iniciado = true; intento.ts = Date.now(); }
  }
  function servicioElegido(servicios) {
    try {
      var lista = listaServicios(servicios); if (!lista.length) return;
      if (reservasAbierta()) { serviciosPendientes = null; iniciarReserva(lista); }
      else serviciosPendientes = lista;                                          // elegido en la portada: cuenta cuando la pantalla de reservas se abra (después del selector de sucursal)
    } catch (e) {}
  }
  function observarReservas() {
    try {
      var e = document.getElementById('vistaReservas'); if (!e) return;
      new MutationObserver(function () { if (reservasAbierta() && serviciosPendientes) { var l = serviciosPendientes; serviciosPendientes = null; iniciarReserva(l); } }).observe(e, { attributes: true, attributeFilter: ['class'] });
    } catch (er) {}
  }
  function nuevoIntentoReserva() { intento = { iniciado: false, ts: 0 }; serviciosPendientes = null; }

  /** Reserva por el chat con IA: elige servicio + hora y va directo a pagar (no abre la pantalla de reservas). */
  function checkoutDesdeChat(propuesta) {
    try {
      if (!propuesta || !propuesta.servicioId) return;
      iniciarReserva([{ id: String(propuesta.servicioId), nombre: String(propuesta.servicioNombre || ''), precio: num(propuesta.precioClp), qty: 1 }]);
    } catch (e) {}
  }

  /** Reserva confirmada SIN anticipo (el servidor ya la confirmó): Schedule, nunca Purchase. */
  function reservaConfirmadaSinAnticipo(info) {
    try {
      var ids = (info && info.ids) || []; var id = ids.length ? String(ids[0]) : '';
      if (!id) return false;                                                      // sin identificador de la reserva no se envía (no se podría evitar un duplicado)
      var lista = listaServicios(info.servicios); var r = paramsServicios(lista, { modalidad: 'sin_anticipo' });
      return enviarUnico('Schedule', r.p, 'schedule_' + id);
    } catch (e) { return false; }
  }

  /* ---------- compra de productos / cursos: InitiateCheckout al pulsar pagar ---------- */
  function checkoutCarrito(carrito, metodo) {
    try {
      if (!activo() || !carrito || !carrito.length) return;
      var curso = carrito.some(function (i) { return i.kind === 'COURSE'; });
      var cat = curso ? 'Curso' : 'Producto';
      var firma = 'ic_carrito_' + carrito.map(function (i) { return i.id + 'x' + (i.qty || 1); }).sort().join(',');
      var prev = Number(ssGet('mlMetaT_' + firma) || 0); if (prev && Date.now() - prev < 30 * 60 * 1000) return;
      var total = carrito.reduce(function (a, i) { return a + num(i.price) * Math.max(1, num(i.qty) || 1); }, 0);
      var p = { content_type: 'product', content_ids: carrito.map(function (i) { return idContenido(cat, i.id); }), content_name: carrito.map(function (i) { return String(i.name || ''); }).join(' + ').slice(0, 200), content_category: cat, num_items: carrito.reduce(function (a, i) { return a + Math.max(1, num(i.qty) || 1); }, 0), value: total, currency: MONEDA };
      if (enviar('InitiateCheckout', p, 'ic_' + aleatorio())) ssSet('mlMetaT_' + firma, String(Date.now()));
    } catch (e) {}
  }

  /* ---------- pago confirmado por el servidor (comprobante) ---------- */
  var retornoPagoTs = 0;
  function marcarRetornoPago() { retornoPagoTs = Date.now(); }
  function clpDeTexto(t) { var d = String(t == null ? '' : t).replace(/[^0-9]/g, ''); var n = d ? parseInt(d, 10) : 0; return isFinite(n) ? n : 0; }
  var CATEGORIA_POR_TIPO = { RESERVATION_DEPOSIT: 'Servicio', RESERVATION_PRODUCTS: 'Producto', PRODUCT_ORDER: 'Producto', COURSE_PURCHASE: 'Curso', CART_ORDER: 'Producto' };
  /** Se llama con el comprobante que el SERVIDOR devolvió tras verificar el pago (solo durante el retorno de Webpay / Mercado Pago). */
  function comprobantePintado(datos) {
    try {
      if (!datos || !retornoPagoTs || Date.now() - retornoPagoTs > 120000) return false;     // solo en el retorno real del pago: reabrir un comprobante más tarde no cuenta
      if (!activo()) {                                                                         // el Pixel puede estar terminando de iniciar (espera a que la URL quede limpia): se reintenta unos segundos
        if (leerConsentimiento() === 'granted' && !bloqueadoPorUrl) { var n = 0; var t = setInterval(function () { if (activo()) { clearInterval(t); procesarComprobante(datos); } else if (++n > 40 || leerConsentimiento() !== 'granted') clearInterval(t); }, 250); }
        return false;
      }
      return procesarComprobante(datos);
    } catch (e) { return false; }
  }
  function procesarComprobante(datos) {
    try {
      var tipo = String(datos.tipo || ''); var orden = String(datos.numeroOperacion || ''); var monto = clpDeTexto(datos.montoTexto);
      if (!orden || !(monto > 0) || !CATEGORIA_POR_TIPO[tipo]) return false;                 // sin n.º de operación, sin importe o de un tipo desconocido: no se envía
      if (datos.estado && String(datos.estado).toLowerCase().indexOf('aprob') !== 0 && String(datos.estado).toLowerCase() !== 'confirmado') return false;
      var cat = datos.tieneCurso ? 'Curso' : CATEGORIA_POR_TIPO[tipo];
      var enviado = false;
      if (tipo === 'RESERVATION_DEPOSIT') {                                                   // reserva con anticipo realmente pagado: Schedule + Purchase por lo cobrado
        enviarUnico('Schedule', { content_type: 'product', content_category: 'Servicio', sucursal: SUCURSAL_PROPIA, modalidad: 'con_anticipo', order_id: orden }, 'schedule_' + orden);
        enviado = enviarUnico('Purchase', { content_type: 'product', content_category: 'Servicio', sucursal: SUCURSAL_PROPIA, modalidad: 'con_anticipo', order_id: orden, value: monto, currency: MONEDA }, 'purchase_' + orden);
      } else {
        var pp = { content_type: 'product', content_category: cat, order_id: orden, value: monto, currency: MONEDA };
        if (tipo === 'RESERVATION_PRODUCTS') pp.sucursal = SUCURSAL_PROPIA;                    // productos comprados junto a una reserva sin anticipo de Ñuñoa
        enviado = enviarUnico('Purchase', pp, 'purchase_' + orden);
      }
      return enviado;
    } catch (e) { return false; }
  }

  /* ---------- Providencia (AgendaPro): solo intención, nunca conversión ---------- */
  function irAAgendaPro() {
    try { return enviar('IrAAgendaPro', { sucursal: SUCURSAL_EXTERNA, destino: 'AgendaPro' }, 'agendapro_' + aleatorio(), true); } catch (e) { return false; }
  }

  /* ---------- aviso de consentimiento ---------- */
  var avisoEl = null;
  function estilos() {
    if (document.getElementById('mlMetaEstilos')) return;
    var s = document.createElement('style'); s.id = 'mlMetaEstilos';
    s.textContent = '#mlMetaAviso{position:fixed;left:16px;bottom:16px;z-index:120;width:min(380px,calc(100% - 32px));box-sizing:border-box;padding:14px 16px;border-radius:16px;background:var(--panel,#fff);color:var(--text-hi,#141311);border:1px solid var(--linea,rgba(20,19,17,.14));box-shadow:0 10px 34px rgba(20,19,17,.18);font-family:var(--font-body,inherit);font-size:.8125rem;line-height:1.4}'
      + '#mlMetaAviso b{display:block;font-size:.875rem;margin-bottom:2px}#mlMetaAviso p{margin:0 0 10px;color:var(--text-mid,#57554f)}#mlMetaAviso .ml-fila{display:flex;gap:8px;align-items:center}'
      + '#mlMetaAviso button{flex:1;font:inherit;font-weight:600;padding:9px 12px;border-radius:12px;border:1px solid var(--linea,rgba(20,19,17,.22));background:transparent;color:inherit;cursor:pointer}#mlMetaAviso button:focus-visible{outline:2px solid currentColor;outline-offset:2px}'
      + '#mlMetaAviso .ml-mas{flex:0 0 auto;border:0;padding:9px 4px;font-weight:500;text-decoration:underline;color:var(--text-mid,#57554f)}'
      + '@media (max-width:760px){#mlMetaAviso{left:12px;right:12px;width:auto;bottom:calc(152px + env(safe-area-inset-bottom))}}';
    document.head.appendChild(s);
  }
  function cerrarAviso() { if (avisoEl && avisoEl.parentNode) avisoEl.parentNode.removeChild(avisoEl); avisoEl = null; }
  function mostrarAviso() {
    try {
      if (!pixelId || avisoEl || gpcRechaza()) return;
      estilos();
      var d = document.createElement('div'); d.id = 'mlMetaAviso'; d.setAttribute('role', 'dialog'); d.setAttribute('aria-label', 'Medición de anuncios');
      var t = document.createElement('b'); t.textContent = 'Medición de anuncios';
      var p = document.createElement('p'); p.textContent = 'Usamos el Pixel de Meta para medir qué anuncios de Facebook e Instagram te traen a MASTERLOOK. No enviamos tu nombre, correo ni teléfono. ¿Lo aceptas?';
      var f = document.createElement('div'); f.className = 'ml-fila';
      var no = document.createElement('button'); no.type = 'button'; no.id = 'mlMetaRechazar'; no.textContent = 'Rechazar';
      var si = document.createElement('button'); si.type = 'button'; si.id = 'mlMetaAceptar'; si.textContent = 'Aceptar';
      var mas = document.createElement('button'); mas.type = 'button'; mas.className = 'ml-mas'; mas.id = 'mlMetaMas'; mas.textContent = 'Más información';
      no.addEventListener('click', function () { decidir('denied'); }); si.addEventListener('click', function () { decidir('granted'); });
      mas.addEventListener('click', function () { try { if (typeof window.abrirModalLegal === 'function') window.abrirModalLegal('privacidadModal'); } catch (e) {} });
      f.appendChild(no); f.appendChild(si); f.appendChild(mas); d.appendChild(t); d.appendChild(p); d.appendChild(f);
      document.body.appendChild(d); avisoEl = d;
    } catch (e) {}
  }
  function decidir(v) {
    guardarConsentimiento(v); cerrarAviso();
    if (v === 'granted') cargarPixel(function () { ultimaPantalla = null; sincronizarPantalla(true); });
    else revocarPixel();
  }
  function abrirPreferencias() { cerrarAviso(); mostrarAviso(); }

  /* ---------- arranque ---------- */
  function arrancar() {
    try {
      if (!pixelId) return;                                                          // sin Pixel para este sitio: ni aviso ni nada
      observarPantallas(); observarReservas();
      var c = leerConsentimiento();
      if (c === 'granted') cargarPixel(function () { sincronizarPantalla(true); });
      else if (c === null) mostrarAviso();
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();

  window.MLMeta = {
    activo: activo, estado: function () { return { pixelId: pixelId, produccion: esProduccion, consentimiento: leerConsentimiento(), cargado: cargado, inicializado: inicializado, bloqueadoPorUrl: bloqueadoPorUrl, registro: registro.slice() }; },
    viewContent: viewContent, servicioElegido: servicioElegido, nuevoIntentoReserva: nuevoIntentoReserva, checkoutDesdeChat: checkoutDesdeChat,
    reservaConfirmadaSinAnticipo: reservaConfirmadaSinAnticipo, checkoutCarrito: checkoutCarrito, marcarRetornoPago: marcarRetornoPago, comprobantePintado: comprobantePintado,
    irAAgendaPro: irAAgendaPro, abrirPreferencias: abrirPreferencias,
  };
})();
