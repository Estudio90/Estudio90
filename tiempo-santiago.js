/**
 * Única referencia horaria del sistema de reservas EN EL NAVEGADOR:
 * America/Santiago, con horario de verano/invierno resuelto automáticamente
 * vía Intl.DateTimeFormat -- NUNCA un offset manual fijo (UTC-3/UTC-4) ni
 * la zona horaria configurada en el dispositivo (solo se asume que el
 * reloj del dispositivo marca un instante real razonablemente correcto,
 * lo mismo que ya exige HTTPS para funcionar).
 *
 * Réplica exacta, en el navegador, de database/functions/tiempoSantiago.js
 * -- mismos nombres de función, mismo comportamiento, para que servidor y
 * cliente resuelvan "la hora de Santiago" siempre de la misma forma. Si
 * el horario de Chile volviera a cambiar de reglas, este archivo NO
 * necesita tocarse: Intl usa la base de datos IANA del propio navegador.
 *
 * Sin build step ni módulos ES -- se incluye con <script src="tiempo-
 * santiago.js"></script> y expone window.TiempoSantiago.
 */
(function (global) {
  'use strict';
  var ZONA = 'America/Santiago';

  var FORMATEADOR_FECHA = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  var FORMATEADOR_HORA = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA, hour: '2-digit', minute: '2-digit', hour12: false,
  });
  var FORMATEADOR_DIA_SEMANA = new Intl.DateTimeFormat('es-CL', {
    timeZone: ZONA, weekday: 'long',
  });

  /** 'YYYY-MM-DD' del día calendario de Santiago para un instante dado. */
  function fechaSantiago(d) {
    return FORMATEADOR_FECHA.format(d || new Date());
  }

  /** Minutos desde medianoche de Santiago para un instante dado. */
  function minutosDelDiaSantiago(d) {
    var partes = FORMATEADOR_HORA.format(d || new Date()).split(':');
    return Number(partes[0]) * 60 + Number(partes[1]);
  }

  /** Nombre del día de la semana en Santiago (ej. "viernes"). */
  function diaSemanaSantiago(d) {
    return FORMATEADOR_DIA_SEMANA.format(d || new Date());
  }

  /** {fecha, minutos} de "ahora" en Santiago, en una sola pasada. */
  function ahoraSantiago() {
    var ahora = new Date();
    return { fecha: fechaSantiago(ahora), minutos: minutosDelDiaSantiago(ahora) };
  }

  /** ¿El horario (fecha calendario + minutos desde medianoche, ambos en
   *  Santiago) ya pasó, según la hora real de Santiago ahora mismo? */
  function yaPasoEnSantiago(fecha, minutosDesdeMedianoche, margenMin) {
    var ref = ahoraSantiago();
    margenMin = margenMin || 0;
    if (fecha < ref.fecha) return true;
    if (fecha > ref.fecha) return false;
    return minutosDesdeMedianoche < ref.minutos + margenMin;
  }

  /** Instante absoluto (epoch ms) de una fecha+hora YA EXPRESADA en hora
   *  de Santiago -- resuelve el offset real (con DST) sin tabla manual:
   *  adivina el instante interpretando fecha+minutos como UTC, le
   *  pregunta a Intl qué fecha+hora quedó eso en Santiago, corrige por la
   *  diferencia, y repite una vez más para converger incluso justo en el
   *  borde de un cambio de horario. */
  function instanteSantiagoMs(fecha, minutosDesdeMedianoche) {
    var partes = fecha.split('-').map(Number);
    var y = partes[0], m = partes[1], d = partes[2];
    var guessMs = Date.UTC(y, m - 1, d, Math.floor(minutosDesdeMedianoche / 60), minutosDesdeMedianoche % 60);
    for (var i = 0; i < 2; i++) {
      var vistoEnSantiago = new Date(guessMs);
      var fpartes = fechaSantiago(vistoEnSantiago).split('-').map(Number);
      var yv = fpartes[0], mv = fpartes[1], dv = fpartes[2];
      var minutosVistos = minutosDelDiaSantiago(vistoEnSantiago);
      var diffDias = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(yv, mv - 1, dv)) / 86400000);
      var diffMin = diffDias * 1440 + (minutosDesdeMedianoche - minutosVistos);
      guessMs += diffMin * 60000;
    }
    return guessMs;
  }

  /** Suma N días CALENDARIO a una fecha 'YYYY-MM-DD' -- aritmética de
   *  calendario pura (Date.UTC explícito sobre las partes Y-M-D), nunca
   *  toca ninguna hora ni zona horaria, así que es exacta sin importar
   *  qué zona configure el dispositivo ni si hay un cambio de horario de
   *  por medio. */
  function sumarDiasSantiago(fecha, n) {
    var partes = fecha.split('-').map(Number);
    var ms = Date.UTC(partes[0], partes[1] - 1, partes[2]) + n * 86400000;
    var d = new Date(ms);
    var yy = d.getUTCFullYear();
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    var dd = String(d.getUTCDate()).padStart(2, '0');
    return yy + '-' + mm + '-' + dd;
  }

  /** Día de la semana (0=domingo..6=sábado) de una fecha 'YYYY-MM-DD',
   *  sin pasar por ninguna zona horaria local ambigua (aritmética de
   *  calendario pura vía UTC -- correcta para cualquier fecha, en
   *  cualquier dispositivo). */
  function diaSemanaNumero(fecha) {
    var partes = fecha.split('-').map(Number);
    return new Date(Date.UTC(partes[0], partes[1] - 1, partes[2])).getUTCDay();
  }

  /** ¿Ese "fecha + minutos desde medianoche" corresponde a un horario de
   *  pared que REALMENTE existe en Santiago? En la madrugada del adelanto
   *  de hora el reloj salta y esa franja nunca ocurre -- instanteSantiagoMs
   *  siempre converge a algún instante real, pero para un horario
   *  inexistente ese instante, visto de vuelta, no reproduce la misma
   *  fecha+minutos pedidas. */
  function existeHorarioEnSantiago(fecha, minutosDesdeMedianoche) {
    var ms = instanteSantiagoMs(fecha, minutosDesdeMedianoche);
    var vistoDeVuelta = new Date(ms);
    return fechaSantiago(vistoDeVuelta) === fecha && minutosDelDiaSantiago(vistoDeVuelta) === minutosDesdeMedianoche;
  }

  global.TiempoSantiago = {
    ZONA: ZONA,
    fechaSantiago: fechaSantiago,
    minutosDelDiaSantiago: minutosDelDiaSantiago,
    diaSemanaSantiago: diaSemanaSantiago,
    ahoraSantiago: ahoraSantiago,
    yaPasoEnSantiago: yaPasoEnSantiago,
    instanteSantiagoMs: instanteSantiagoMs,
    sumarDiasSantiago: sumarDiasSantiago,
    diaSemanaNumero: diaSemanaNumero,
    existeHorarioEnSantiago: existeHorarioEnSantiago,
  };
})(window);
