# Plan de Entreno

Aplicación privada para un entrenador y sus alumnos. Usa Node.js 24, SQLite y almacenamiento local privado de MP4. La interfaz está en español rioplatense y la semana actual se calcula en America/Argentina/Buenos_Aires. La base empieza vacía.

## Vista web

[Abrí la demostración privada de Plan de Entreno](https://plan-de-entreno-gino.ginogervasoni.chatgpt.site/). Ingresá con la cuenta de ChatGPT propietaria del sitio. La demostración usa rutinas de ejemplo y guarda los cambios solo hasta que recargues.

## Puesta en marcha

1. Instalá Node.js 24 o posterior. Abrí una terminal en esta carpeta.
2. Definí `COACH_NAME`, `COACH_EMAIL` y `COACH_PASSWORD` en el entorno. La contraseña debe tener entre 12 y 128 caracteres. Ejecutá `node server.mjs --coach` para crear la cuenta. El mismo comando actualiza el acceso del entrenador e invalida sus sesiones.
3. Quitá las variables de la cuenta del entorno de ejecución y corré `node server.mjs`. Abrí http://localhost:3000.
4. En **Alumnos**, creá una ficha y usá **Generar invitación**. Compartí el enlace de forma privada. Dura 72 horas. Generar uno nuevo invalida el anterior.

## Servidor para uso real

- Ejecutá la aplicación como usuario de servicio con un volumen persistente y privado. `DATA_DIR` indica dónde se guardan SQLite y los videos. El valor predeterminado es `./data`. Incluí ambos en las copias de seguridad.
- Serví la aplicación detrás de un proxy HTTPS y configurá `APP_URL` con el origen público exacto, por ejemplo `https://entreno.example.com`. Esto habilita cookies seguras y genera enlaces que se pueden abrir desde otros dispositivos. `HOST` y `PORT` controlan dónde escucha Node. Los valores predeterminados son `127.0.0.1` y `3000`. Configurá el proxy para permitir cargas de hasta 100 MB y solicitudes de rango.
- Para habilitar la recuperación por correo, configurá `RESET_WEBHOOK` y `RESET_WEBHOOK_TOKEN`. El servicio de correo debe aceptar un POST JSON con `email` y `link`, autenticado con el encabezado `Authorization: Bearer …`, y enviar el enlace de recuperación al correo indicado. El enlace vence en una hora. Mientras falte esa configuración, la pantalla de recuperación informa que el envío no está habilitado.
- Los videos se reproducen mediante URLs temporales ligadas a la sesión. El servidor vuelve a verificar el permiso en cada solicitud. Usá MP4 con video H.264 para favorecer la reproducción en celulares. También podés adjuntar un enlace a un video de YouTube en la ficha del ejercicio. El enlace abre una pestaña nueva y el acceso depende de la visibilidad configurada en YouTube. Si cargás un MP4 y agregás un enlace, el alumno ve ambas opciones.

## Verificación

Ejecutá `node --test` desde esta carpeta. Las pruebas levantan un servidor con una base temporal, crean cuentas de demostración y generan dos MP4 breves con ffmpeg. Para correrlas, instalá ffmpeg con libx264.
