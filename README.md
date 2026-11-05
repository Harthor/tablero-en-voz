Tablero en Voz: lee en voz alta posiciones y partidas de ajedrez de Lichess para jugadores ciegos. Se usa desde https://harthor.github.io/tablero-en-voz/

## Partes

- `index.html`: la página del alumno. Funciona sola (partidas, puzzles y seguimiento en vivo de Lichess) y, si el alumno abrió su link de invitación, muestra las clases de su profesor.
- `profesor.html`: el panel del profesor. Sirve para crear alumnos, armar clases con capítulos (PGN, FEN, partidas o estudios de Lichess), escribir comentarios, grabar audios, marcar jugadas como pregunta y ver el progreso.
- `js/datos.js`: la conexión con Supabase. Con `?demo` en la dirección todo se guarda en el navegador, sin cuenta.
- `js/pgn.js`: lee PGN con comentarios y lecciones interactivas de Lichess.
- `js/diagrama.js`: diagramas desde una foto, una captura o un PDF. Busca los tableros de cada página, pide la posición a la IA y la controla casilla por casilla con un lector propio.
- `supabase/functions/leer-diagrama/index.ts`: la función de Supabase que le pasa la imagen a Claude. La clave de la IA queda en Supabase, no en la página.
- `supabase/esquema.sql`: las tablas, los permisos por fila y el depósito de audios.

## Puesta en marcha de Supabase (una sola vez)

1. En el proyecto de Supabase, ir a **SQL Editor → New query**, pegar `supabase/esquema.sql` completo y apretar **Run**.
2. En **Authentication → Sign In / Providers**, activar **Allow anonymous sign-ins**. Así el alumno entra con su link, sin usuario ni contraseña.
3. En **Authentication → URL Configuration**:
   - **Site URL:** `https://harthor.github.io/tablero-en-voz/profesor.html`
   - En **Redirect URLs**, agregar `https://harthor.github.io/tablero-en-voz/**`

## Lectura de diagramas con IA (una sola vez)

1. Crear una clave en https://console.anthropic.com (**API Keys → Create Key**) y cargarle crédito. Cada diagrama cuesta alrededor de uno o dos centavos de dólar.
2. En Supabase, volver a correr `supabase/esquema.sql` completo en el **SQL Editor**. Agrega el tope diario: 150 lecturas por profesor y 40 por alumno.
3. En **Edge Functions → Secrets**, agregar `ANTHROPIC_API_KEY` con la clave del paso 1.
4. En **Edge Functions → Deploy a new function → Via Editor**:
   - Ponerle de nombre `leer-diagrama`.
   - Pegar el contenido de `supabase/functions/leer-diagrama/index.ts` y apretar **Deploy**.
   - Si al leer un diagrama aparece un error de autorización, en los ajustes de la función desactivar **Verify JWT**. La función ya controla quién la usa.

Sin estos pasos todo lo demás funciona igual. Al leer un diagrama, el profesor ve solo dónde hay piezas y de qué color, y el alumno escucha que falta configurar la IA.

## Publicar una versión nueva

```bash
cd ~/dev/projects/tablero-en-voz
git add -A
git commit -m "Describir el cambio"
git push
```
