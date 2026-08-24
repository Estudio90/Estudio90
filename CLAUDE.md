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

Toda plata (abonos, cobros, propinas, ventas de productos/cursos) pasa por la colección `paymentMovements` — `recordType: 'operation' | 'movement' | 'incident'`, idempotente por `operationId`. Reglas duras:

- **Nunca crear una segunda fuente financiera** ni un ledger paralelo por reserva.
- Solo `recordType:'movement'` cuenta en cualquier total/reporte. `'operation'` es solo el ancla de idempotencia. `'incident'` es dinero dudoso que no se migró a ciegas — vive aparte, nunca se suma al total confirmado.
- `registrarCobroReserva` (Cloud Function) es el único punto de entrada para cobros/abonos presenciales — nunca escribir campos de pago directo a un documento de `bookings`.

## Estados de una reserva

Los 4 estados operativos vigentes (`etiqueta` en Firestore): **RESERVADO** (teal, nuevo), **PENDIENTE** (amarillo), **ASISTIÓ** (rosado oscuro `#d64fb0`), **NO ASISTIÓ** (rojo). Valores viejos (`new`, `ok`, `resched`, `done`) siguen en documentos históricos y en `tagLabels` solo para mostrarlos bien — **ningún código los vuelve a escribir**.

Reglas de negocio, no negociables:

- **Pagar el abono (aunque sea el 100%) nunca marca ASISTIÓ.** Confirmar el pago = pasar a RESERVADO. Asistencia es siempre una acción manual del staff (click en la etiqueta o en "Marcar asistencia").
- **Comisión del barbero**: se calcula en vivo (nunca se persiste como registro aparte) con la condición `etiqueta === 'asistio' || etiqueta === 'done'` (el `'done'` es compatibilidad con historial). Por eso clickear ASISTIÓ dos veces, o corregir a NO ASISTIÓ después, nunca deja una comisión fantasma — no hay nada que duplicar.
- **NO ASISTIÓ**: comisión $0, pero el abono ya pagado queda para el negocio (nunca se borra ni se convierte en comisión).

## Transbank / Webpay

Actualmente en **modo Integración** (pruebas), con las credenciales de producción ya cargadas pero sin activar. **Solo la dueña cambia Integración → Producción, manualmente, en su propio momento.** Nunca debe pasar solo porque se hizo un deploy o por un valor por defecto en el código.

## Reglas de trabajo con Claude Code

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
