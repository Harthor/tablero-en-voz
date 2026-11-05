// Tablero en Voz · lee un diagrama de ajedrez (foto, captura o página de libro) con Claude.
// Recibe { imagen: <base64>, tipo: 'image/png' | 'image/jpeg' | 'image/webp' } y devuelve
// { filas: [8 textos de 8 letras, de arriba abajo como se ven], abajo, turno, titulo, dudosas }.
// La clave ANTHROPIC_API_KEY vive en los secretos de Supabase, nunca en la página.
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TIPOS = ["image/png", "image/jpeg", "image/webp", "image/gif"];

const PROMPT = `La imagen tiene un diagrama de ajedrez (de un libro, un PDF, una captura de pantalla o una foto).
Leé la posición con mucho cuidado, casilla por casilla. En los libros las casillas oscuras suelen estar rayadas: una casilla rayada sin figura está vacía.
Las piezas blancas se dibujan huecas (contorno con interior claro) y las negras rellenas.

Devolvé:
- filas: las 8 filas del tablero tal como se ven en la imagen, de arriba hacia abajo. Cada fila es un texto de exactamente 8 caracteres, de izquierda a derecha: K Q R B N P para las blancas (rey, dama, torre, alfil, caballo, peón), k q r b n p para las negras y . para una casilla vacía.
- abajo: "blancas" si las blancas juegan desde abajo del diagrama (lo normal), "negras" si el diagrama está dado vuelta (por ejemplo, si las coordenadas muestran la fila 8 abajo o la columna h a la izquierda).
- turno: "w" si el texto indica que juegan las blancas (por ejemplo "1.?" o "juegan las blancas"), "b" si indica que juegan las negras (por ejemplo "1...?" o "juegan las negras"), "?" si no se sabe.
- titulo: el texto que acompaña al diagrama (número de ejercicio, jugadores, lugar, año), en una sola línea; vacío si no hay.
- dudosas: las casillas (en notación como e4, con las blancas abajo) donde no estás seguro de la pieza.
Si hay varios diagramas, leé solo el más grande o el que está en el centro.`;

const ESQUEMA = {
  type: "object",
  properties: {
    filas: { type: "array", items: { type: "string" } },
    abajo: { type: "string", enum: ["blancas", "negras"] },
    turno: { type: "string", enum: ["w", "b", "?"] },
    titulo: { type: "string" },
    dudosas: { type: "array", items: { type: "string" } },
  },
  required: ["filas", "abajo", "turno", "titulo", "dudosas"],
  additionalProperties: false,
};

function responder(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return responder({ error: "Usá POST." }, 405);

  // Quién llama: un profesor o un alumno vinculado (lo decide usar_ia() con los permisos de la base).
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return responder({ error: "sin_sesion" }, 401);
  // La clave pública del proyecto (la misma que usa la página); sirve si el entorno no trae SUPABASE_ANON_KEY.
  const publica = Deno.env.get("SUPABASE_ANON_KEY") || "sb_publishable_eRJW53Vx1sro8aPt_sPCVQ_eLMsde01";
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, publica, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const uso = await sb.rpc("usar_ia");
  if (uso.error) {
    const m = uso.error.message || "";
    if (/limite_ia/.test(m)) return responder({ error: "limite_ia" }, 429);
    return responder({ error: /sin_permiso_ia/.test(m) ? "sin_permiso_ia" : "sin_sesion" }, 403);
  }

  let datos: { imagen?: string; tipo?: string };
  try { datos = await req.json(); } catch { return responder({ error: "Mandá la imagen en JSON." }, 400); }
  const tipo = datos.tipo ?? "image/png";
  if (!datos.imagen || !TIPOS.includes(tipo)) return responder({ error: "Falta la imagen o el formato no es válido." }, 400);
  if (datos.imagen.length > 6_000_000) return responder({ error: "La imagen es demasiado grande." }, 413);

  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!clave) return responder({ error: "sin_clave_ia" }, 500);
  const client = new Anthropic({ apiKey: clave });

  try {
    const r = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 16000,
      output_config: { effort: "high", format: { type: "json_schema", schema: ESQUEMA } },
      // Si un filtro de seguridad rechaza el pedido por error, la API lo reintenta con otro modelo.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: tipo, data: datos.imagen } },
          { type: "text", text: PROMPT },
        ],
      }],
    } as any);
    if (r.stop_reason === "refusal") return responder({ error: "La IA no quiso leer esta imagen." }, 422);
    const texto = r.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    const out = JSON.parse(texto);
    return responder({ ...out, quedan: uso.data });
  } catch (e) {
    console.error(e);
    const estado = e instanceof Anthropic.APIError ? e.status : 0;
    if (estado === 401) return responder({ error: "sin_clave_ia" }, 500);
    if (estado === 429 || estado === 529) return responder({ error: "La IA está saturada. Probá de nuevo en un minuto." }, 503);
    return responder({ error: "No se pudo leer la imagen. Probá de nuevo." }, 502);
  }
});
