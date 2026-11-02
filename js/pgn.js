// Tablero en Voz · lectura de PGN con comentarios (chess.js 0.10 los descarta).
// Un capítulo queda así:
//   { id, titulo, fen, jugadas: ['e4', 'e5', ...], lado: 'w'|'b',
//     notas: { '<ply>': { t: 'comentario', a: 'ruta del audio', p: true } } }
// La nota del ply 0 es la introducción; la del ply k va con la jugada k (k = 1 es la primera).
// p: true marca la jugada k como pregunta: el alumno tiene que encontrarla.
var PGN = (function () {
  var START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  // Un archivo o estudio con varias partidas → un texto por partida.
  function separar(texto) {
    return String(texto).replace(/\r\n?/g, '\n').split(/\n\s*\n(?=\s*\[Event )/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  function limpiarComentario(c) {
    // Lichess guarda flechas, casillas marcadas, relojes y evaluaciones como [%cal ...], [%csl ...], [%clk ...].
    return c.replace(/\[%[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  }

  function leer(texto) {
    var headers = {}, body = String(texto).replace(/\r\n?/g, '\n');
    body = body.replace(/^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/gm, function (_, k, v) { headers[k] = v.replace(/\\(.)/g, '$1'); return ''; });
    var fen = headers.FEN ? completar(headers.FEN) : START;
    var chess = new Chess();
    if (!chess.load(fen)) throw new Error('El FEN de la partida no es válido.');
    var jugadas = [], notas = {}, i = 0, depth = 0, n = body.length;
    function nota(ply, t) { if (!t) return; var x = notas[ply] = notas[ply] || {}; x.t = x.t ? x.t + ' ' + t : t; }
    while (i < n) {
      var ch = body[i];
      if (ch === '{') {
        var j = body.indexOf('}', i); if (j < 0) j = n;
        if (!depth) nota(jugadas.length, limpiarComentario(body.slice(i + 1, j)));
        i = j + 1; continue;
      }
      if (ch === ';') { var e = body.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
      // Las variantes se saltean por ahora: solo la línea principal.
      if (ch === '(') { depth++; i++; continue; }
      if (ch === ')') { depth = Math.max(0, depth - 1); i++; continue; }
      if (/\s/.test(ch)) { i++; continue; }
      var m = /^[^\s{}();]+/.exec(body.slice(i, i + 40)); var tok = m ? m[0] : ch; i += tok.length;
      if (depth) continue;
      tok = tok.replace(/^\d+\.+/, '');
      if (!tok || /^\$\d+$/.test(tok) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(tok) || /^\d+$/.test(tok)) continue;
      var san = tok.replace(/[!?]+$/, '').replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');
      var mv = chess.move(san, { sloppy: true });
      if (!mv) throw new Error('La jugada “' + tok + '” (número ' + (jugadas.length + 1) + ') no es legal. Revisá el PGN.');
      jugadas.push(mv.san);
    }
    var lado = /^b/i.test(headers.Orientation || '') ? 'b' : 'w';
    // Lección interactiva de un estudio de Lichess: las jugadas del lado del alumno son preguntas.
    if (headers.ChapterMode === 'gamebook') marcarPreguntas({ fen: fen, jugadas: jugadas, notas: notas }, lado);
    var titulo = headers.ChapterName || ((headers.White || headers.Black) && !/^\?$/.test(headers.White || '') ? (headers.White || '?') + ' – ' + (headers.Black || '?') : '') || headers.Event || 'Partida';
    return { titulo: titulo, fen: fen, jugadas: jugadas, notas: notas, lado: lado, headers: headers };
  }

  function completar(f) {
    var p = f.trim().split(/\s+/);
    while (p.length < 6) p.push(['w', '-', '-', '0', '1'][p.length - 1]);
    return p.slice(0, 6).join(' ');
  }

  // Color que mueve en la jugada k (1 = primera).
  function colorDe(cap, k) {
    var blancasEmpiezan = cap.fen.split(' ')[1] !== 'b';
    return ((k % 2 === 1) === blancasEmpiezan) ? 'w' : 'b';
  }
  function marcarPreguntas(cap, color) {
    for (var k = 1; k <= cap.jugadas.length; k++) {
      var x = cap.notas[k] = cap.notas[k] || {};
      if (colorDe(cap, k) === color) x.p = true; else delete x.p;
      if (!x.t && !x.a && !x.p) delete cap.notas[k];
    }
  }

  return { START: START, separar: separar, leer: leer, completar: completar, colorDe: colorDe, marcarPreguntas: marcarPreguntas };
})();
