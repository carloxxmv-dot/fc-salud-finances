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
Se guardan en el propio dispositivo (IndexedDB), así que **no se pierden al recargar**, pero tampoco se sincronizan entre móviles. Usa "Exportar copia" de vez en cuando.

## Cómo probarla
Sirve esta carpeta con un servidor web, por ejemplo:

    cd FCSALUD-app-movil && python3 -m http.server 8080

y abre http://localhost:8080. Para **instalarla en el móvil** tiene que estar publicada en una dirección `https` (Vercel, Netlify, GitHub Pages…). Después: en iPhone, Compartir → Añadir a pantalla de inicio; en Android, menú ⋮ → Instalar aplicación.

## Conexión
La app funciona sin conexión una vez abierta. La tipografía Georama, la lectura de facturas y la generación del PDF se descargan de internet la primera vez que se usan y quedan guardadas.

## Archivos
`index.html`, `styles.css`, `app.js`, `sw.js` (modo sin conexión), `manifest.webmanifest` e `icons/` (generados desde el logotipo).
