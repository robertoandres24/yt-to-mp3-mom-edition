# YouTube MP3

Aplicación de escritorio sencilla para guardar el audio de **un video de YouTube** como MP3. Todo se procesa en el equipo. No tiene backend remoto, hosting, cuentas, suscripciones ni costos de operación. Requiere internet para acceder a YouTube. Utilízala solo con contenido que tengas derecho a descargar.

## Uso

1. Abre YouTube MP3 y pega el enlace del video.
2. Revisa el destino: un pendrive USB montado y escribible tiene prioridad; si no hay ninguno, se usa **Descargas**. Con varios USB se elige el primero por orden de ruta. Puedes elegir otro con **Cambiar**.
3. Pulsa **Descargar MP3**. Espera la descarga y conversión.
4. Al ver **Descarga terminada**, pulsa **Abrir carpeta**.

Puedes cancelar. Solo se permite una descarga a la vez. Cerrar la aplicación durante una descarga detiene también sus procesos hijos y limpia los temporales. Los MP3 existentes se conservan; una descarga repetida recibe un sufijo numérico. La carpeta elegida manualmente se respeta durante la sesión. La detección USB se actualiza al enfocar la ventana y al iniciar otra descarga. Si se retira el pendrive durante una descarga, se muestra un error y no se cambia silenciosamente el destino.

Durante **Preparando el video…** no se muestra un porcentaje, porque YouTube todavía no ha entregado el audio. La barra refleja los bytes descargados o los fragmentos completados cuando comienza la transferencia; si el total no está disponible, se muestra la cantidad descargada en MB. Los porcentajes no retroceden cuando cambia una estimación. Durante la conversión se mantiene en 99% y llega a 100% al guardar el MP3. Con videos pequeños o conexiones rápidas, la preparación puede durar más que la descarga y el porcentaje avanzar muy rápido.

El audio se guarda como **MP3 a 192 kbps**, aproximadamente **1,44 MB por minuto** (5,8 MB para 4 minutos). Se descarga la mejor pista disponible y se convierte una sola vez. Esto reemplaza la calidad variable máxima anterior, que producía archivos mayores sin recuperar información perdida en la fuente. Los archivos ya descargados no se modifican.

## Desarrollo

Requisitos del **desarrollador**: Node.js 24 LTS, npm y acceso a npm/GitHub para descargar dependencias y binarios. El usuario final no instala Node, Python, yt-dlp, FFmpeg ni Deno.

```sh
npm install
npm run binaries:mac          # arquitectura del Mac actual
# En Windows:
npm run binaries:win
npm start
```

```sh
npm run check                 # sintaxis JS
npm test                      # validación, procesos, errores, cancelación y archivos
npm run test:smoke            # abre Electron y prueba preload/IPC/aislamiento; después cierra
npm run test:tools            # descargas lentas reales (directa y HLS), progreso en vivo y conversión MP3
npm run test:packaged         # comprueba la .app generada por build:mac
```

La prueba de herramientas levanta un servidor HTTP de prueba en loopback por unos segundos. La aplicación distribuida no incluye ni ejecuta un servidor.

## Build Windows (x64)

Ejecuta preferentemente en Windows 10/11 x64:

```sh
npm ci
npm run build:win
```

Genera:

```text
dist/
  YouTube MP3 Setup.exe
  YouTube MP3 Portable.exe
```

`electron-builder` incluye mediante `extraResources`:

```text
resources/bin/win/
  yt-dlp.exe
  _internal/                 # runtime de yt-dlp, también obligatorio
  ffmpeg.exe
  ffprobe.exe
  deno.exe
  ...avisos, licencias y checksums
```

Es posible hacer cross-build desde macOS, pero NSIS puede requerir Wine y herramientas auxiliares. La comprobación definitiva debe hacerse en Windows real: instalación, portable, USB, cancelación durante conversión, carpetas con espacios y tildes, desconexión USB y descarga de un video autorizado. El build no está firmado; Windows puede mostrar avisos de editor desconocido. Firmar requiere un certificado y no es necesario para este MVP personal.

En este Mac Apple Silicon el cross-build llegó a generar `dist/win-unpacked`, pero NSIS falló al ejecutar su compilador Intel (`Unknown system error -86`, Rosetta no disponible). No se generaron Setup/Portable válidos en esta máquina. Ejecutar el mismo comando en Windows evita esta dependencia de arquitectura.

## Build macOS

```sh
npm run build:mac             # Apple Silicon: .dmg y .zip
npm run build:mac:intel       # Mac Intel: .dmg y .zip
```

Salida Apple Silicon:

```text
dist/YouTube MP3-arm64.dmg
dist/YouTube MP3-arm64.zip
dist/mac-arm64/YouTube MP3.app
```

Abre el DMG y arrastra la aplicación a **Aplicaciones**. El ZIP contiene la app lista para copiar. Para probar directamente también puedes abrir la `.app` de `dist/mac-arm64/`.

El paquete personal no cuenta con firma Developer ID ni notarización de Apple. Si macOS bloquea su apertura, usa **Configuración del Sistema → Privacidad y seguridad → Abrir de todos modos**, solo si confías en este build. No es necesario desactivar Gatekeeper. El DMG es el instalador habitual de Mac; no se genera un `.exe` para macOS.

## Organización y seguridad

- `src/main.js`: ventana, IPC limitado, carpetas y ciclo de vida.
- `src/preload.js`: API explícita mediante `contextBridge`.
- `src/core.js`: validación, argumentos, descarga, cancelación y limpieza.
- `src/destination.js`: detección de volúmenes USB en macOS y Windows.
- `src/index.html`, `style.css`, `renderer.js`: interfaz en español sin frameworks.
- `scripts/`: preparación de binarios, checks y prueba de herramientas.
- `test/`: pruebas del comportamiento principal.

Electron usa `contextIsolation: true`, `nodeIntegration: false`, sandbox y CSP sin conexiones del renderer. No se permiten navegación, ventanas externas ni permisos web. El proceso principal valida el emisor IPC y normaliza enlaces a un solo video: watch, youtu.be, Shorts, live y embed. Rechaza otros hosts, credenciales, puertos y listas sin video. `spawn` recibe argumentos separados con `shell: false`; nunca se interpola la URL en un comando. La app ignora configuraciones externas de yt-dlp, evita playlists y no descarga emisiones que sigan en vivo. Los errores se muestran en español, sin terminales.

Las descargas se preparan dentro de una subcarpeta temporal del destino, luego se copian con exclusividad para no sobrescribir archivos. Solo se limpian las carpetas creadas por esa descarga. Un cierre forzado del sistema puede dejar una carpeta `.youtube-mp3-*`; puede eliminarse manualmente cuando la app esté cerrada.

## Binarios y mantenimiento

`scripts/binary-manifest.json` fija las URLs/versiones y los SHA-256. Los scripts verifican las descargas y los archivos existentes antes de reutilizarlos. Los checksums iniciales de assets antiguos que no publican digest se fijan desde una primera descarga HTTPS del proveedor; no constituyen una firma del editor. Los binarios y `dist` no se suben a Git; el lockfile de npm sí debe conservarse.

Se usa la distribución oficial **onedir** de yt-dlp (`yt-dlp_macos.zip` / `yt-dlp_win.zip`), preparada durante el build. El ejecutable y `_internal/` se incluyen juntos mediante `extraResources`, evitando descomprimir el runtime en cada descarga. El instalador resulta mayor, pero el usuario no instala Python. Se verifica cada archivo del runtime al reutilizarlo en un build y se rechazan enlaces y rutas que escapen del ZIP.

La app permite una caché local de yt-dlp dentro de su carpeta de datos de usuario (`yt-dlp-cache`), para reutilizar información del reproductor cuando la herramienta lo admita. No se almacenan ahí los MP3 ni se requieren cookies. La primera ejecución puede tardar más por las comprobaciones de macOS; las consultas a YouTube también dependen de la conexión.

Medición en el Mac de desarrollo con el video `sal78l1W6fE`: el ejecutable anterior demoró 13,4–15,1 s solo en arrancar; el nuevo, 0,19 s después de su primera ejecución. La preparación completa fue 1,47 s y el proceso total 4,06 s. Sobre el mismo audio de 303 segundos, el MP3 bajó de 10,14 MB (calidad variable 0) a 7,27 MB (192 kbps), aproximadamente un 28% menos. Son mediciones de esa prueba, no una garantía para todos los videos o equipos.

Se incluye Deno porque el soporte actual de YouTube en yt-dlp necesita resolver desafíos JavaScript. Los ejecutables oficiales de yt-dlp ya incluyen los scripts EJS: no se habilita descarga de componentes remotos durante el uso. Referencia: https://github.com/yt-dlp/yt-dlp/wiki/EJS

YouTube puede cambiar o restringir ciertos videos. Los videos privados, protegidos, con restricción de edad o que exijan autenticación pueden fallar. Este MVP no pide cookies ni credenciales ni intenta evadir esas restricciones. Para actualizar, revisa nuevas versiones y digests en el manifiesto, vuelve a preparar los binarios y recompila; no hay autoactualizaciones.

Consulta `THIRD-PARTY-NOTICES.md` y los archivos LICENSE/README de los binarios antes de redistribuir. Algunos builds de FFmpeg para Mac incluyen componentes `nonfree`; estos paquetes se preparan para prueba personal, y se deben sustituir por builds redistribuibles antes de publicar instaladores para terceros.

## Diagnóstico de errores

Los fallos distinguen preparación del destino, herramientas de la app, descarga, conversión y guardado. **Ver detalle del error** muestra la etapa, código y salida técnica; **Abrir registros** abre la carpeta de diagnóstico local. Se guardan fecha, versión de la app, plataforma, enlace normalizado del video, destino, etapa, código de salida y los últimos 12.000 caracteres de cada salida de yt-dlp. Los registros no se envían a ningún servidor; pueden contener rutas personales y enlaces de videos.

El archivo `logs/download-errors.jsonl` está dentro de la carpeta de datos de usuario de Electron. Rota al alcanzar 1 MB y conserva un archivo anterior. Si no puede escribirse, el detalle sigue disponible en pantalla. Cancelar una descarga no se registra como fallo.
