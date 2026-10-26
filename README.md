# FCSALUD · App móvil (PWA)

App web instalable para el control diario de la Clínica FC Salud, creada a partir de `facturaclaro-simple.html`.

## Qué incluye
- **Hoy**: balance del día, accesos de un toque a TPV, Efectivo y Gasto, y lista de movimientos. Desliza la tarjeta verde para cambiar de día.
- **Registrar**: tipo (TPV / Efectivo / Gasto), área (Fisioterapia / Podología), importe grande con importes frecuentes, patología (con las más usadas a un toque) y fecha.
- **Gastos con foto o PDF**: la app lee proveedor e importe total en el propio móvil (Tesseract.js) y guarda el justificante para verlo o descargarlo después.
- **Historial**: por mes, agrupado por día, con buscador y filtros por tipo y área.
- **Resumen**: TPV y efectivo de Podología y Fisioterapia, total cobrado, reparto por área, ranking de patologías (por sesiones o por ingresos, del mes o del año), gráfico día a día e **informe mensual para la asesoría** (descargar o enviar).
- **Informe mensual (PDF)**: cuadros de resumen, listado solo de gastos y, a continuación, las facturas subidas ese mes (imágenes y PDF).
- **Justificantes**: se borran solos del móvil a los 4 meses de subirlos.
- **Ajustes**: proyectos, área preseleccionada, copia de seguridad (exportar/importar con justificantes) y borrado de datos.
- Editar, eliminar con "Deshacer", cerrar hojas deslizando hacia abajo o con el botón Atrás de Android.

## Datos
Todo (movimientos, proyectos y facturas) se guarda en un almacén **privado de Vercel Blob**, protegido con contraseña. Cada móvil guarda además una copia local (IndexedDB) para funcionar sin conexión, y sincroniza los cambios en cuanto hay internet.

- Variables de entorno en Vercel: `APP_PASSWORD` (contraseña inicial), `SESSION_SECRET` (firma de la sesión) y `BLOB_READ_WRITE_TOKEN` (la crea Vercel al conectar el almacén).
- La contraseña se puede cambiar desde Ajustes; entonces se guarda cifrada (scrypt) en `config/auth.json` y `APP_PASSWORD` deja de usarse.
- Funciones en `/api`: `login`, `password`, `data` y `doc` (facturas en `docs/{id}`, máx. 4 MB). Las fotos se comprimen en el móvil antes de subirlas.
- Los movimientos se reparten por año (`data/moves/2026.json`…) y `data/meta.json` guarda la lista de años, los borrados, los proyectos y la versión. El antiguo `data/fcsalud.json` se pasa solo a este formato la primera vez y se conserva como copia.
- Cada escritura comprueba la versión (ETag) del archivo: si dos móviles guardan a la vez, el segundo vuelve a leer y aplica sus cambios, así no se pierde ninguno.
- Si el móvil ya tiene la última versión, la sincronización solo lee `meta.json` (menos operaciones del plan gratuito).
- Copia de seguridad automática semanal de los movimientos en `backups/` (se guardan las 8 últimas; las facturas no se incluyen).
- Para probar en local sin Vercel: `FC_LOCAL_STORE=./store` guarda en una carpeta.

## Cómo probarla
Sirve esta carpeta con un servidor web, por ejemplo:

    cd FCSALUD-app-movil && python3 -m http.server 8080

y abre http://localhost:8080. Para **instalarla en el móvil** tiene que estar publicada en una dirección `https` (Vercel, Netlify, GitHub Pages…). Después: en iPhone, Compartir → Añadir a pantalla de inicio; en Android, menú ⋮ → Instalar aplicación.

## Conexión
La app funciona sin conexión una vez abierta. La tipografía Georama, la lectura de facturas y la generación del PDF se descargan de internet la primera vez que se usan y quedan guardadas.

## Archivos
`index.html`, `styles.css`, `app.js`, `sw.js` (modo sin conexión), `manifest.webmanifest` e `icons/` (generados desde el logotipo)., `api/` (servidor en Vercel) y `package.json`.
