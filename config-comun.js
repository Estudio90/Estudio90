// Config compartida entre los 3 archivos estáticos de public/ (sin build
// step, sin módulos: cada HTML la carga con <script src="config-comun.js">).
//
// Única fuente, del lado del cliente, del UID de la dueña como fallback de
// ADMIN cuando su cuenta no tiene documento en `staff` (la misma constante
// vive, por separado, en database/firestore.rules -- isAdmin() -- y en
// database/functions/env.js -- OWNER_UID -- porque esas son capas de
// servidor/reglas que no pueden compartir código con HTML estático).
const OWNER_UID_FALLBACK = 'VKtOl9PCTgRiBeWG96d6UNp4JGx2';
