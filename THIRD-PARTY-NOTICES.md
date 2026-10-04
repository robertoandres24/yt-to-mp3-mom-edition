# Componentes incluidos

La aplicación funciona localmente y se conecta a YouTube únicamente para obtener el contenido solicitado. Los binarios se descargan en desarrollo/build, nunca automáticamente en la aplicación instalada.

- Electron: MIT, https://github.com/electron/electron/blob/main/LICENSE
- yt-dlp 2026.08.19: Unlicense para el proyecto; los ejecutables PyInstaller contienen dependencias con licencias adicionales, incluida GPLv3+. Fuentes y avisos: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19
- Deno 2.9.7: MIT y licencias de terceros, https://github.com/denoland/deno/tree/v2.9.7
- FFmpeg/FFprobe: distribuciones de ffmpeg-static b6.1.1. Se incluyen LICENSE y README originales con sus enlaces a código fuente/configuración en la carpeta bin del paquete. https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1
- plist: MIT, https://github.com/TooTallNate/plist.js

Para redistribuir los instaladores, conserva los avisos y revisa las obligaciones de distribución y entrega de fuentes de cada binario y sus dependencias. Este MVP se prepara para uso personal.
