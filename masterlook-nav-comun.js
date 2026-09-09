/* Barra de navegación del ÁREA INTERNA ADMINISTRATIVA de Masterlook.
 *
 * Alcance exclusivo: páginas internas de staff (masterlook-panel-interno.html,
 * masterlook-email-marketing.html, y las que se agreguen después). JAMÁS se
 * incluye en masterlook-sitio.html ni index.html (sitio público) -- ninguna
 * persona no autenticada como staff debe poder verla.
 *
 * Un solo lugar para los apartados: si se cambia un nombre, un destino, o se
 * agrega/quita una sección, se edita ACÁ y ninguna página necesita tocarse
 * (salvo que la sección nueva necesite su propio callback en el panel).
 *
 * Permisos: cada ítem declara qué roles YA lo tienen permitido HOY en
 * masterlook-panel-interno.html (mismo criterio que sus botones equivalentes
 * del menú lateral -- ver soloAdmin/cliOn en mostrarControlesAdmin()). Este
 * archivo no otorga ningún acceso nuevo, solo refleja el que ya existe:
 *   - Ventas/Productos/Reportes/Email Marketing: ADMIN únicamente
 *     (btnResumenVentas/btnProductos/btnIntelligence/btnCampanas son
 *     soloAdmin hoy; Email Marketing es el reemplazo de Campañas).
 *   - Administración (abre el menú lateral existente): ADMIN + RECEPTION,
 *     porque RECEPTION ya tiene acceso parcial a ese menú hoy (Clientes,
 *     Horarios, etc. -- ver cliOn en mostrarControlesAdmin()).
 *   - Agenda: ADMIN + RECEPTION (BARBER tiene su propia vista aparte,
 *     mostrarVistaBarbero(), fuera de esta barra).
 *   - BARBER: no cumple ningún rol de la lista -> la barra completa no se
 *     pinta para ese rol (ver `render`).
 *
 * Navegación:
 *   - Dentro del panel (enPanel:true): cada click llama DIRECTO a la función
 *     que la página ya tiene (pasada en `callbacks`) -- no se reimplementa
 *     ninguna lógica de vistas.
 *   - Desde otra página (enPanel:false): reutiliza el mecanismo que el panel
 *     YA tiene para "recordar/restaurar sección" (sessionStorage.mlUltimaSeccion
 *     + restaurarSeccionActiva(), que además YA respeta la visibilidad por rol
 *     porque no hace nada si el botón de destino está display:none) en vez de
 *     inventar un router nuevo. "Administración" usa una bandera aparte,
 *     mlAbrirMenu, porque no es una vista sino el menú lateral completo.
 */
(function (global) {
  'use strict';

  var ITEMS = [
    { key: 'agenda', label: 'Agenda', roles: ['ADMIN', 'RECEPTION'] },
    { key: 'ventas', label: 'Ventas', roles: ['ADMIN'], boton: 'btnResumenVentas' },
    { key: 'productos', label: 'Productos', roles: ['ADMIN'], boton: 'btnProductos' },
    { key: 'reportes', label: 'Reportes', roles: ['ADMIN'], boton: 'btnIntelligence' },
    { key: 'administracion', label: 'Administración', roles: ['ADMIN', 'RECEPTION'] },
    { key: 'email-marketing', label: 'Email Marketing', roles: ['ADMIN'] },
  ];

  var CSS_ID = 'mlnav-estilos';
  function inyectarCSS() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    // Colores vía var(--...) de masterlook-estilos-comunes.css -- ambas
    // páginas host lo cargan antes de que esto se inyecte (recién se
    // llama tras resolver el rol, ya con el <head> completo). Fallbacks
    // literales solo por si alguna página futura la usa sin cargarlo.
    s.textContent =
      '.mlnav{display:flex;align-items:center;gap:4px;padding:0 32px;height:48px;' +
      'background:var(--panel,#fff);border-bottom:1px solid var(--border,#e0e4e4);overflow-x:auto;}' +
      '.mlnav-item{font-family:inherit;font-size:14px;color:var(--text-mid,#4c5559);background:none;' +
      'border:none;border-bottom:2px solid transparent;padding:0 4px;height:100%;' +
      'display:flex;align-items:center;cursor:pointer;white-space:nowrap;margin-right:24px;}' +
      '.mlnav-item:hover{color:var(--text-hi,#2c3941);}' +
      '.mlnav-item.on{color:var(--accent,#8046ce);border-bottom-color:var(--accent,#8046ce);font-weight:500;}' +
      '@media (max-width:760px){.mlnav{padding:0 14px;}.mlnav-item{margin-right:16px;font-size:13px;}}';
    document.head.appendChild(s);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  /**
   * @param {Object} o
   * @param {HTMLElement} o.contenedor - dónde pintar la barra.
   * @param {string} [o.activo] - key del ítem actual (se marca .on).
   * @param {string} o.rol - 'ADMIN' | 'RECEPTION' | 'BARBER' | null.
   * @param {boolean} o.enPanel - true si esta página ES masterlook-panel-interno.html.
   * @param {Object} [o.callbacks] - { [key]: function() } solo si enPanel.
   */
  function render(o) {
    var contenedor = o && o.contenedor;
    if (!contenedor) return;
    var rol = o.rol;
    if (rol !== 'ADMIN' && rol !== 'RECEPTION') {
      contenedor.innerHTML = '';
      contenedor.style.display = 'none';
      return;
    }
    inyectarCSS();
    var visibles = ITEMS.filter(function (it) { return it.roles.indexOf(rol) !== -1; });
    contenedor.className = 'mlnav';
    contenedor.style.display = '';
    contenedor.innerHTML = visibles.map(function (it) {
      return '<button type="button" class="mlnav-item' + (it.key === o.activo ? ' on' : '') + '" data-mlnav="' + it.key + '">' + esc(it.label) + '</button>';
    }).join('');
    contenedor.querySelectorAll('[data-mlnav]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        navegar(btn.getAttribute('data-mlnav'), o.enPanel, o.callbacks);
      });
    });
  }

  var ICON_BUSCAR = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  var ICON_AJUSTES = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>';

  /**
   * Header compartido del área interna (52px: logo + buscador/chip/ajustes/
   * avatar). Fuente visual exacta: masterlook-email-marketing.html. Genera
   * SOLO la fila del logo -- la barra Agenda/Ventas/... de abajo sigue
   * siendo `render()` (arriba), ya compartida desde antes.
   *
   * No wirea clicks de hamburguesa/avatar por sí mismo: cada página YA tiene
   * su propio código más abajo que hace `getElementById('btnMenuLateral')`
   * (panel) etc. y lo conecta -- alcanza con que este HTML exista con los
   * IDs correctos ANTES de que ese código corra. Por eso se llama desde un
   * <script> inline pegado al contenedor, en el lugar donde vivía el header
   * viejo (el documento se parsea en orden, así que ya existe para cuando
   * el script grande de más abajo lo busca). El logo SÍ se wirea acá si se
   * pasa `onLogo` (Email Marketing no tiene código propio para eso).
   *
   * @param {Object} o
   * @param {HTMLElement} o.contenedor
   * @param {boolean} [o.mostrarHamburguesa] - true en el panel (abre el menú lateral).
   *   Va DENTRO de mlhdr-right (no antes del logo): "Administración" en la
   *   barra de abajo ya hace exactamente lo mismo (abrirMenuLateral), así
   *   que este botón es un atajo redundante, no el único camino -- y
   *   ponerlo antes del logo corría el logo ~60px a la derecha respecto a
   *   Email Marketing (medido: x:80 vs x:20), rompiendo la posición
   *   idéntica que se pidió. Con esto el logo queda en la MISMA
   *   coordenada en las dos páginas sin sacar el botón.
   * @param {string} [o.idBurger='btnMenuLateral']
   * @param {string} [o.idLogo='wordmarkHome']
   * @param {function} [o.onLogo] - si se pasa, se wirea el click del logo acá mismo.
   * @param {string} [o.chipTexto] - texto del chip (p.ej. "Ago 2026" / "Reservas Online").
   * @param {string} [o.chipIcono] - SVG opcional antes del texto del chip.
   * @param {string} [o.idAvatar='who']
   * @param {string} [o.avatarIniciales='--']
   * @param {string} [o.dropdownHtml] - HTML del menú de cuenta (solo panel; EM no tiene).
   */
  function renderHeader(o) {
    var contenedor = o && o.contenedor;
    if (!contenedor) return;
    var idBurger = o.idBurger || 'btnMenuLateral';
    var idLogo = o.idLogo || 'wordmarkHome';
    var idAvatar = o.idAvatar || 'who';

    var burgerHtml = o.mostrarHamburguesa
      ? '<button type="button" class="mlhdr-icon mlhdr-burger" id="' + esc(idBurger) + '" aria-label="Abrir menú" title="Menú"><span></span><span></span><span></span></button>'
      : '';
    var chipHtml = o.chipTexto
      ? '<div class="mlhdr-pill">' + (o.chipIcono || '') + esc(o.chipTexto) + '</div>'
      : '';
    var avatarClase = 'mlhdr-avatar' + (o.dropdownHtml ? ' clickable' : '');

    contenedor.className = 'mlhdr';
    contenedor.innerHTML =
      '<div class="mlhdr-logo" id="' + esc(idLogo) + '" title="Ir al inicio" style="cursor:pointer;"><span class="mlhdr-mark">M</span>MASTER LOOK</div>' +
      '<div class="mlhdr-right">' +
        burgerHtml +
        '<div class="mlhdr-icon" title="Buscar">' + ICON_BUSCAR + '</div>' +
        chipHtml +
        '<div class="mlhdr-icon" title="Configuración">' + ICON_AJUSTES + '</div>' +
        '<div class="mlhdr-avatar-wrap">' +
          '<div class="' + avatarClase + '" id="' + esc(idAvatar) + '" title="Mi cuenta">' + esc(o.avatarIniciales || '--') + '</div>' +
          (o.dropdownHtml || '') +
        '</div>' +
      '</div>';

    if (typeof o.onLogo === 'function') {
      document.getElementById(idLogo).addEventListener('click', o.onLogo);
    }
  }

  function navegar(key, enPanel, callbacks) {
    var item = null;
    for (var i = 0; i < ITEMS.length; i++) if (ITEMS[i].key === key) item = ITEMS[i];
    if (!item) return;

    if (enPanel) {
      if (callbacks && typeof callbacks[key] === 'function') callbacks[key]();
      return;
    }

    // Desde otra página: navega al panel (o al archivo correspondiente) y le
    // deja la instrucción de a dónde ir apenas cargue, vía los mecanismos
    // que el panel ya tiene.
    if (key === 'email-marketing') { location.href = 'masterlook-email-marketing.html'; return; }
    if (key === 'administracion') {
      sessionStorage.setItem('mlAbrirMenu', '1');
      sessionStorage.removeItem('mlUltimaSeccion');
    } else if (item.boton) {
      sessionStorage.setItem('mlUltimaSeccion', item.boton);
      sessionStorage.removeItem('mlAbrirMenu');
    } else {
      // 'agenda': sin sección específica que restaurar -> cae al inicio por defecto.
      sessionStorage.removeItem('mlUltimaSeccion');
      sessionStorage.removeItem('mlAbrirMenu');
    }
    location.href = 'masterlook-panel-interno.html';
  }

  global.MLNav = { ITEMS: ITEMS, render: render, renderHeader: renderHeader };
})(window);
