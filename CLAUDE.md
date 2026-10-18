# Master Look — contexto del proyecto

Panel de administración + sitio público para una barbería/estudio de belleza. Léelo completo antes de tocar código: varias reglas acá evitan errores ya cometidos (y corregidos) en sesiones anteriores.

## Arquitectura

- **`public/masterlook-panel-interno.html`** — panel interno (admin/recepción/barbero). Un solo archivo gigante: HTML+CSS+JS todo junto, sin build step, sin módulos. Al editar, busca la sección exacta con Grep antes de asumir dónde vive algo.
- **`public/masterlook-sitio.html`** — sitio público donde el cliente reserva y paga.
- **`database/functions/`** — Cloud Functions (Firebase, Node). Backend real: Firestore + Admin SDK.
- Sin framework, sin bundler. Todo se sirve como archivos estáticos.

## Dos repos — no confundirlos

- **`Masterlookpriv`** (privado) — remote de trabajo.
- **`Estudio90/Estudio90`** (público) — este es el que de verdad sirve el sitio en vivo, en `estudio90.github.io/Estudio90/`. Es producción real, con clientes reales.

Si trabajas con Claude Code: pregunta explícitamente a cuál de los dos hay que subir antes de hacer push, sobre todo para cambios grandes. Un error ya ocurrido en este proyecto: subir toda una sesión de trabajo al repo privado pensando que era el que se veía en vivo.

## Fuente única de dinero: `paymentMovements`

Toda plata (abonos, cobros, propinas, ventas de productos/cursos) pasa por la colección `paymentMovements` — `recordType: 'operation' | 'movement' | 'incident' | 'movement_anulado'`, idempotente por `operationId`. Reglas duras:

- **Nunca crear una segunda fuente financiera** ni un ledger paralelo por reserva.
- Solo `recordType:'movement'` cuenta en cualquier total/reporte. `'operation'` es solo el ancla de idempotencia. `'incident'` es dinero dudoso que no se migró a ciegas — vive aparte, nunca se suma al total confirmado. `'movement_anulado'` es un movimiento ANULADO: historial conservado, jamás vuelve a contar.
- `registrarCobroReserva` (Cloud Function) es el único punto de entrada para cobros/abonos presenciales — nunca escribir campos de pago directo a un documento de `bookings`.
- Dinero de prueba (`paymentEnvironment:'integration'`, Webpay en modo Integración) NUNCA es ingreso ni comisión: lo excluyen `comisionesServicios.js` y `resumenVentas.js`. "Sin campo" cuenta como real.

### Anulación de ventas (regla 10-2026, auditoría de caja del 16-10)

Borrar/cancelar una reserva **no toca el ledger por sí solo** (`cancelarReserva` solo elimina el doc y libera agenda — así quedó huérfano un cobro de prueba de $17.990). El mecanismo correcto vive en `anulacionVentas.js` (repo Masterlookpriv):

- **Anular una venta = reclasificar sus movimientos a `recordType:'movement_anulado'`** (callable `anularVentaReserva`, transaccional e idempotente). Nunca se borra un movimiento ni se ajusta un total a mano. Como todos los agregadores suman `recordType:'movement'`, la venta sale sola de ingresos, saldos y comisiones en todos los reportes. La comisión de servicios jamás se persiste, así que "revertirla" es automático e imposible de duplicar.
- Roles: ADMIN y RECEPTION anulan; venta pagada+asistida o reserva ya eliminada: **solo ADMIN**. La etiqueta no se toca al anular.
- Trigger `alEliminarReserva` (onDocumentDeleted de `bookings`): al eliminarse una reserva anula solo dinero de prueba (`integration`); el dinero real se CONSERVA (abono de no-show o seña retenida son ingreso) y queda marcado `reservaEliminada` para auditoría.
- Panel: al eliminar una cita con pagos, el flujo pregunta si anular la venta o conservar el dinero; una venta pagada+asistida advierte que eliminarla hace desaparecer la comisión. Botón «Anular venta…» en la ficha, mismo candado.

### Propinas (regla 10-2026, en producción 18-10)

Las propinas se reportan SOLO desde el ledger vía `obtenerReportePropinas` (`propinas.js`, repo Masterlookpriv): día completo de Chile, 100% al profesional de SU reserva (por `barberId`, jamás un % de comisión), «pendiente de asignación» aparte — nunca se reparte sola. Estado Pendiente/Pagado en `propinaPayments` (solo ADMIN, espejo de `commissionPayments`, doc único por profesional+período = imposible duplicar un pago); registrar un pago guarda monto/método/fecha/responsable + historial y JAMÁS altera el histórico. No volver a calcular propinas client-side (la pantalla vieja usaba el estado legado 'done' → siempre $0).

### Zona horaria de reportes

`resumenVentas.js` arma el rango del día en **America/Santiago** (`rangoResumenSantiago` vía `tiempoSantiago.js`, DST automático). Nunca `new Date('YYYY-MM-DDT00:00:00')` en una Cloud Function (el servidor corre en UTC y corría el día 3-4 horas). Serie diaria con `fechaSantiago()`, nunca `toISOString()`. Tests: `database/tests-ventas/` en Masterlookpriv (casos A–H, emulador) — obligatorios antes de publicar cambios a estos módulos.

## Estados de una reserva

Los 4 estados operativos vigentes (`etiqueta` en Firestore): **RESERVADO** (teal, nuevo), **PENDIENTE** (amarillo), **ASISTIÓ** (rosado oscuro `#d64fb0`), **NO ASISTIÓ** (rojo). Valores viejos (`new`, `ok`, `resched`, `done`) siguen en documentos históricos y en `tagLabels` solo para mostrarlos bien — **ningún código los vuelve a escribir**.

Reglas de negocio, no negociables:

- **Pagar el abono (aunque sea el 100%) nunca marca ASISTIÓ.** Confirmar el pago = pasar a RESERVADO. Asistencia es siempre una acción manual del staff (click en la etiqueta o en "Marcar asistencia").
- **Comisión del barbero** (regla 10-2026): se calcula en vivo (nunca se persiste como registro aparte) con DOS condiciones a la vez: **servicio pagado completo** (suma de movimientos `concepto:'servicio'` del ledger ≥ `price` — anticipo + saldo son UNA sola venta) **y** `etiqueta === 'asistio' || 'done'` (`'done'` es compatibilidad con historial). Pagar nunca marca asistencia, y asistir sin pagar no genera comisión. El cálculo vive en el servidor (`comisionesServicios.js`: `obtenerReporteComisiones` para ADMIN, y compartido con `obtenerMisComisiones`); por eso re-consultar o corregir una etiqueta nunca duplica nada. Tarifa: override por servicio > % por defecto del profesional > **% general** (`settings/comisiones.general` — cambiarlo jamás toca los individuales) > 42. Base = monto del servicio realmente cobrado según el ledger. Redondeo `Math.round` por servicio.
- **Asistencia y pagos: solo ADMIN/Recepción.** Un BARBER no escribe `bookings` (ni etiqueta ni campos de pago — reglas de Firestore lo exigen); solo consulta sus comisiones vía callables. Una reserva **pagada y asistida queda cerrada para Recepción**: solo un ADMIN puede corregirla.
- **NO ASISTIÓ**: comisión $0, pero el abono ya pagado queda para el negocio (nunca se borra ni se convierte en comisión).

## Transbank / Webpay

Actualmente en **modo Integración** (pruebas), con las credenciales de producción ya cargadas pero sin activar. **Solo la dueña cambia Integración → Producción, manualmente, en su propio momento.** Nunca debe pasar solo porque se hizo un deploy o por un valor por defecto en el código.

## Medición (GA4/Ads) y Email Marketing — ya construidos, no reinventar

- **Medición GA4 + Google Ads (en producción)**: IDs SOLO en `config-medicion.js`; `google-medicion.js` es el módulo (espejo de meta-consent.js, mismos puntos de evento del Pixel). El aviso de cookies es COMPARTIDO: UN botón «Aceptar» activa Google y Meta a la vez — **jamás un botón «Solo necesarias» que también active medición**, y agregar herramientas nunca cambia el aviso. Sin aceptar: cero peticiones a Google. UTM/gclid/ml_r se capturan en sessionStorage `mlUtm` y `registrarOrigenReserva` (Cloud Function) los escribe una sola vez en la reserva.
- **Email marketing v2.3 (rama email-tracking-dev, DEV)**: `ml_r` = token opaco por destinatario en los enlaces (hash, NUNCA el correo); detalle por persona en «Ver reporte» (`emailCampanaDestinatarios`); «Validar base» local (`emailValidarBase`); atribución de reservas por token. Tracking de Resend (aperturas/clics + subdominio `masterlook.envios.masterlook.cl`) verificado el 16-10. Aperturas SIEMPRE rotuladas «estimadas»; clics de bots filtrados (<10 s de la entrega o varios enlaces el mismo segundo).

## Reglas de trabajo con Claude Code

- **A producción (`main` de este repo y `--project estudio90`) se sube SOLO lo que la dueña aprobó explícitamente** — pieza por pieza, nunca "todo lo de la rama".
- **Reglas de Firestore (incidente 16-10-2026)**: campos opcionales SIEMPRE con `resource.data.get('campo', defecto)` — el acceso directo a un campo ausente es ERROR y deniega. Ningún cambio de reglas va a producción sin pasar `database/tests-reglas/` (en Masterlookpriv).

- **Probar en vivo antes de dar algo por terminado.** No alcanza con que el código "se vea bien" — recargar el panel real (o el de prueba) y confirmar que funciona, revisar la consola por errores, antes de decir que está listo.
- **No commitear código sin probarlo primero.**
- **No rediseñar el panel sin que te lo pidan explícitamente.** Sí está bien: corregir bugs puntuales, o trabajar diseño cuando el pedido es justo ese ("rediseña esta parte", "usa la skill de diseño").
- **Nunca uses `confirm()`, `prompt()` ni `alert()` nativos del navegador en el panel** — Chrome los bloquea en silencio ahí. Usar el sistema de modal propio (`.mg-modal`).
- **Los navegadores integrados (WhatsApp, Instagram, etc.) no persisten `localStorage`** de forma confiable. Si algo debe verse bien desde el primer render en esos navegadores, hornea el valor por defecto directo en el HTML estático — no dependas de JS seteando `localStorage` antes del primer paint.
- Antes de una migración de datos o un cambio que toque histórico: explicar primero exactamente qué se va a modificar, nunca migrar/borrar a ciegas.

## Identidad visual (skill `impeccable`)

Este proyecto tiene la skill de diseño **Impeccable** instalada en `.claude/skills/impeccable/` (solo la skill, sin hooks automáticos — nada corre solo al editar). Se usa para pulir vistas puntuales cuando se pide explícitamente (ver más abajo qué ya se estableció, para no reinventarlo cada vez).

- **Tipografías reales**: `--font-primary` (Bricolage Grotesque, para títulos y números — siempre con `font-variant-numeric:tabular-nums` en cifras) y `--font-body` (Poppins, para texto/labels). Los controles nativos (`<select>`, `<input type=date>`, `<button>`) no heredan tipografía por defecto del navegador — hay que fijarla a mano en cada uno.
- **"Vidrio líquido"**: el lenguaje visual para superficies oscuras/primarias (placas destacadas, botones primarios, día/mes seleccionado, tarjetas KPI): `background` en gradiente + `backdrop-filter:blur()` + un resplandor suave (`::before` con `radial-gradient`) + `box-shadow` con inset highlight. Ya aplicado en varios lugares del panel — reusar el mismo patrón antes de inventar uno nuevo.
- **Nunca emoji como ícono.** Íconos propios, un solo trazo consistente (SVG `stroke="currentColor"`, sin relleno) — ver `RV_ICONS` en el panel como ejemplo ya armado.
- Scrollbar propia (delgada, sin flechas) ya aplicada globalmente — no dejar que un contenedor nuevo vuelva a mostrar la barra nativa de Windows.

## Si trabajan dos personas a la vez

Este archivo es lo que mantiene sincronizados a los dos Claude Code (cada sesión no comparte memoria con la otra — esto sí, porque vive en el repo). Si tomas una decisión de arquitectura o descubres una regla de negocio nueva que no esté anotada acá, agrégala en este archivo como parte del mismo commit.

Como `masterlook-panel-interno.html` es un solo archivo enorme, coordinar por sección (agenda / comisiones / abonos / resumen de ventas / etc.) evita conflictos de merge feos. `git pull` antes de empezar, siempre.
