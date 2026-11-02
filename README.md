Tablero en Voz: lee en voz alta posiciones y partidas de ajedrez de Lichess para jugadores ciegos. Se usa desde https://harthor.github.io/tablero-en-voz/

## Partes

- `index.html`: la página del alumno. Funciona sola (partidas, puzzles y seguimiento en vivo de Lichess) y, si el alumno abrió su link de invitación, muestra las clases de su profesor.
- `profesor.html`: el panel del profesor. Sirve para crear alumnos, armar clases con capítulos (PGN, FEN, partidas o estudios de Lichess), escribir comentarios, grabar audios, marcar jugadas como pregunta y ver el progreso.
- `js/datos.js`: la conexión con Supabase. Con `?demo` en la dirección todo se guarda en el navegador, sin cuenta.
- `js/pgn.js`: lee PGN con comentarios y lecciones interactivas de Lichess.
- `supabase/esquema.sql`: las tablas, los permisos por fila y el depósito de audios.

## Puesta en marcha de Supabase (una sola vez)

1. En el proyecto de Supabase, ir a **SQL Editor → New query**, pegar `supabase/esquema.sql` completo y apretar **Run**.
2. En **Authentication → Sign In / Providers**, activar **Allow anonymous sign-ins**. Así el alumno entra con su link, sin usuario ni contraseña.
3. En **Authentication → URL Configuration**:
   - **Site URL:** `https://harthor.github.io/tablero-en-voz/profesor.html`
   - En **Redirect URLs**, agregar `https://harthor.github.io/tablero-en-voz/**`

## Publicar una versión nueva

```bash
cd ~/dev/projects/tablero-en-voz
git add -A
git commit -m "Describir el cambio"
git push
```
