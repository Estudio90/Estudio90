/* ============================================================================================================
 * masterlook-enlaces.js  --  valores de configuración ÚNICOS de los enlaces de reserva.
 *
 * Lo cargan: /reservar/ (redirige según ?sede= y ?profesional=), masterlook-sitio.html (el selector de sucursales) y
 * el panel de Email Marketing (sección «Enlaces de reserva»). Para cambiar un enlace se edita SOLO este archivo y se publica este archivo.
 *
 * No es un secreto: es un enlace público de AgendaPro. No contiene claves ni datos de clientes.
 * ============================================================================================================ */
window.ML_ENLACES = Object.freeze({
  // Agenda de la sucursal Providencia (AgendaPro). Única copia de este valor.
  providencia: 'https://masterlook.site.agendapro.com/cl/sucursal/318540',
  // Dominios a los que /reservar/ puede redirigir fuera de masterlook.cl (red de seguridad: un error de tipeo arriba no puede mandar a nadie a otro sitio).
  dominiosExternos: ['agendapro.com'],
  // Origen público con el que se arman los enlaces que se copian y pegan (anuncios, correos, Instagram, WhatsApp).
  origenProduccion: 'https://masterlook.cl',
  // ¿Se agregan las UTM al enlace de AgendaPro al redirigir? (false = el enlace de AgendaPro se abre tal cual).
  providenciaConUtm: false
});
