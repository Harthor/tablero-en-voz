// Tablero en Voz · diagramas de ajedrez desde una imagen o un PDF.
// - abrir(archivo): imagen o PDF → documento con sus páginas (canvas).
// - buscar(canvas): encuentra los tableros de una página por su marco.
// - leerLocal(canvas, caja): lector propio, gratis; dice por casilla si está vacía ('.'),
//   o si hay una pieza blanca ('B') o negra ('N'). Está pensado para diagramas de libro.
// - leer(canvas, caja): pide la posición completa a la IA (Datos.leerDiagrama) y la controla
//   con el lector propio; las casillas en las que no coinciden quedan como dudas.
var Diagrama = (function () {
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  var FILES = 'abcdefgh';

  // ---------- abrir ----------
  var cargaPdf = null;
  function pdfjs() {
    return cargaPdf = cargaPdf || new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = PDFJS + 'pdf.min.js';
      s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; ok(window.pdfjsLib); };
      s.onerror = function () { cargaPdf = null; no(new Error('No se pudo cargar el lector de PDF. Revisá internet.')); };
      document.head.appendChild(s);
    });
  }
  function esPdf(f) { return f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''); }
  function abrir(f) {
    if (esPdf(f)) {
      return Promise.all([pdfjs(), f.arrayBuffer()]).then(function (r) {
        return r[0].getDocument({ data: r[1] }).promise;
      }).then(function (pdf) {
        return {
          n: pdf.numPages, nombre: f.name || 'PDF',
          pagina: function (i) {
            return pdf.getPage(i).then(function (p) {
              var v1 = p.getViewport({ scale: 1 }), esc = Math.min(3, 1600 / v1.width), v = p.getViewport({ scale: esc });
              var c = document.createElement('canvas'); c.width = Math.round(v.width); c.height = Math.round(v.height);
              var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
              return p.render({ canvasContext: x, viewport: v }).promise.then(function () { return c; });
            });
          }
        };
      }, function (e) { throw /lector de PDF/.test(e.message) ? e : new Error('No pude abrir ese PDF.'); });
    }
    if (!/^image\//.test(f.type)) return Promise.reject(new Error('Elegí una imagen (foto o captura) o un PDF.'));
    return new Promise(function (ok, no) {
      var url = URL.createObjectURL(f), img = new Image();
      img.onload = function () {
        var esc = Math.min(1, 2000 / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * esc); c.height = Math.round(img.height * esc);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok({ n: 1, nombre: f.name || 'Imagen', pagina: function () { return Promise.resolve(c); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('No pude abrir esa imagen.')); };
      img.src = url;
    });
  }
  // Imagen pegada con Ctrl+V (por ejemplo, copiada de WhatsApp o de una captura).
  function delPortapapeles(e) {
    var it = e.clipboardData && e.clipboardData.items; if (!it) return null;
    for (var i = 0; i < it.length; i++) if (it[i].kind === 'file' && /^image\/|pdf$/.test(it[i].type)) return it[i].getAsFile();
    return null;
  }

  // ---------- buscar tableros ----------
  function oscuros(c, caja) {
    caja = caja || { x: 0, y: 0, w: c.width, h: c.height };
    var d = c.getContext('2d', { willReadFrequently: true }).getImageData(caja.x, caja.y, caja.w, caja.h).data, n = caja.w * caja.h, m = new Uint8Array(n);
    for (var i = 0; i < n; i++) m[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) < 128 ? 1 : 0;
    return m;
  }
  // Tramos oscuros largos en una dirección, unidos en líneas (los bordes del marco).
  function lineas(m, W, H, vertical, minLen) {
    var abiertas = [], todas = [], A = vertical ? W : H, B = vertical ? H : W;
    for (var a = 0; a < A; a++) {
      var segs = [], ini = -1;
      for (var b = 0; b <= B; b++) {
        var v = b < B && (vertical ? m[b * W + a] : m[a * W + b]);
        if (v && ini < 0) ini = b;
        if (!v && ini >= 0) { if (b - ini >= minLen) segs.push([ini, b - 1]); ini = -1; }
      }
      var siguen = [];
      segs.forEach(function (s) {
        var l = abiertas.find(function (l) { return l.fin === a - 1 && Math.abs(l.b0 - s[0]) <= 3 && Math.abs(l.b1 - s[1]) <= 3; });
        if (l) { l.fin = a; l.b0 = Math.min(l.b0, s[0]); l.b1 = Math.max(l.b1, s[1]); }
        else { l = { a0: a, fin: a, b0: s[0], b1: s[1] }; todas.push(l); }
        siguen.push(l);
      });
      abiertas = siguen;
    }
    return todas;
  }
  // Achica la caja mientras el borde siga siendo parte del marco (más de 60% oscuro).
  function sinMarco(m, W, k) {
    function fila(y) { var n = 0; for (var x = k.x; x < k.x + k.w; x++) n += m[y * W + x]; return n / k.w; }
    function col(x) { var n = 0; for (var y = k.y; y < k.y + k.h; y++) n += m[y * W + x]; return n / k.h; }
    var t = Math.max(6, Math.round(k.w * 0.03));
    for (var i = 0; i < t && k.h > 16 && fila(k.y) > 0.6; i++) { k.y++; k.h--; }
    for (i = 0; i < t && k.h > 16 && fila(k.y + k.h - 1) > 0.6; i++) k.h--;
    for (i = 0; i < t && k.w > 16 && col(k.x) > 0.6; i++) { k.x++; k.w--; }
    for (i = 0; i < t && k.w > 16 && col(k.x + k.w - 1) > 0.6; i++) k.w--;
    return k;
  }
  // Una caja marcada a mano: se sacan primero los márgenes blancos y después el marco.
  function ajustar(c, k) {
    var m = oscuros(c), W = c.width;
    k = { x: Math.max(0, k.x), y: Math.max(0, k.y), w: Math.min(k.w, c.width - Math.max(0, k.x)), h: Math.min(k.h, c.height - Math.max(0, k.y)) };
    function fila(y) { var n = 0; for (var x = k.x; x < k.x + k.w; x++) n += m[y * W + x]; return n / k.w; }
    function col(x) { var n = 0; for (var y = k.y; y < k.y + k.h; y++) n += m[y * W + x]; return n / k.h; }
    // Si cerca de cada lado hay una línea del marco, ese lado se lleva hasta ahí; si no, queda como está.
    var tope = Math.round(Math.min(k.w, k.h) * 0.25), i;
    for (i = 0; i < tope && fila(k.y + i) <= 0.6; i++); if (i < tope) { k.y += i; k.h -= i; }
    for (i = 0; i < tope && fila(k.y + k.h - 1 - i) <= 0.6; i++); if (i < tope) k.h -= i;
    for (i = 0; i < tope && col(k.x + i) <= 0.6; i++); if (i < tope) { k.x += i; k.w -= i; }
    for (i = 0; i < tope && col(k.x + k.w - 1 - i) <= 0.6; i++); if (i < tope) k.w -= i;
    return sinMarco(m, W, k);
  }
  function buscar(c) {
    var W = c.width, H = c.height, m = oscuros(c), minLen = Math.max(60, Math.round(Math.min(W, H) * 0.12));
    var hs = lineas(m, W, H, false, minLen), vs = lineas(m, W, H, true, minLen), cajas = [];
    hs.forEach(function (t) {
      hs.forEach(function (b) {
        if (b.a0 <= t.fin + minLen || Math.abs(t.b0 - b.b0) > 4 || Math.abs(t.b1 - b.b1) > 4) return;
        var w = t.b1 - t.b0, h = b.a0 - t.fin, r = h / w;
        if (r < 0.92 || r > 1.08) return;
        var iz = vs.find(function (v) { return Math.abs(v.b0 - t.a0) <= 4 + (t.fin - t.a0) && v.b1 >= b.fin - 4 && Math.abs(v.a0 - t.b0) <= 4; });
        var de = vs.find(function (v) { return Math.abs(v.b0 - t.a0) <= 4 + (t.fin - t.a0) && v.b1 >= b.fin - 4 && Math.abs(v.fin - t.b1) <= 4; });
        if (!iz || !de || iz === de) return;
        cajas.push({ x: iz.fin + 1, y: t.fin + 1, w: de.a0 - iz.fin - 1, h: b.a0 - t.fin - 1 });
      });
    });
    // Sin las que quedan dentro de otra (líneas internas de la cuadrícula).
    cajas = cajas.filter(function (k) {
      return !cajas.some(function (o) { return o !== k && o.x <= k.x + 2 && o.y <= k.y + 2 && o.x + o.w >= k.x + k.w - 2 && o.y + o.h >= k.y + k.h - 2 && o.w * o.h > k.w * k.h; });
    });
    cajas = cajas.map(function (k) { return sinMarco(m, W, k); });
    cajas.sort(function (p, q) { return Math.abs(p.y - q.y) > p.h / 2 ? p.y - q.y : p.x - q.x; });
    // Una captura recortada justo al tablero no tiene marco: se usa la imagen entera.
    if (!cajas.length && W / H > 0.85 && W / H < 1.18) cajas.push({ x: 0, y: 0, w: W, h: H, entera: true });
    return cajas;
  }

  // ---------- lector propio ----------
  // Trabaja en la resolución original. El tamaño del filtro se adapta al rayado del libro:
  // se usa el más chico con el que las casillas oscuras vacías (la mayoría) quedan limpias.
  function integral(m, W, H, valor) {
    var I = new Uint32Array((W + 1) * (H + 1));
    for (var y = 0; y < H; y++) { var fila = 0; for (var x = 0; x < W; x++) { fila += m[y * W + x] === valor ? 1 : 0; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + fila; } }
    return I;
  }
  // Fracción de pixeles de la zona cuyo cuadrado de lado k alrededor es todo del mismo valor.
  function solido(I, W, k, xa, ya, xb, yb) {
    var r = k >> 1, n = 0, t = 0, kk = k * k, W1 = W + 1;
    for (var y = ya; y < yb; y++) for (var x = xa; x < xb; x++) {
      var y0 = y - r, x0 = x - r, y1 = y0 + k, x1 = x0 + k; t++;
      if (I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0] === kk) n++;
    }
    return n / t;
  }
  // Parte de la casilla que es blanco encerrado por un contorno (el interior de una pieza blanca):
  // el blanco al que no se llega desde el borde de la casilla. El rayado llega siempre al borde.
  function encerrado(m, W, xa, ya, xb, yb) {
    var w = xb - xa, h = yb - ya, vis = new Uint8Array(w * h), pila = [], n = 0, libres = 0;
    function libre(x, y) { return m[(ya + y) * W + xa + x] === 0; }
    for (var x = 0; x < w; x++) { pila.push(x, 0, x, h - 1); }
    for (var y = 0; y < h; y++) { pila.push(0, y, w - 1, y); }
    while (pila.length) {
      var py = pila.pop(), px = pila.pop(), i = py * w + px;
      if (px < 0 || py < 0 || px >= w || py >= h || vis[i] || !libre(px, py)) continue;
      vis[i] = 1; n++;
      pila.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
    }
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) if (libre(x, y)) libres++;
    return (libres - n) / (w * h);
  }
  function leerLocal(c, caja) {
    var W = caja.w, H = caja.h, m = oscuros(c, caja), Id = integral(m, W, H, 1), Il = integral(m, W, H, 0);
    var cw = W / 8, ch = H / 8, mg = Math.max(2, Math.round(Math.min(cw, ch) * 0.1));
    var zonas = [];
    for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) {
      var z = { r: r, f: f, osc: (r + f) % 2 === 1, xa: Math.round(f * cw + mg), xb: Math.round((f + 1) * cw - mg), ya: Math.round(r * ch + mg), yb: Math.round((r + 1) * ch - mg), d: 0 };
      for (var y = z.ya; y < z.yb; y++) for (var x = z.xa; x < z.xb; x++) z.d += m[y * W + x];
      z.d /= (z.xb - z.xa) * (z.yb - z.ya);
      zonas.push(z);
    }
    var oscs = zonas.filter(function (z) { return z.osc; });
    function elegir(I, limite) {
      for (var k = 3; k <= Math.max(3, Math.round(cw / 4)); k += 2) {
        var limpias = oscs.filter(function (z) { return solido(I, W, k, z.xa, z.ya, z.xb, z.yb) <= limite; }).length;
        if (limpias >= oscs.length * 0.5) return k;
      }
      return 0;
    }
    var kN = elegir(Id, 0.01), kB = elegir(Il, 0);
    if (!kN || !kB) return null;
    // Ocupada: en las claras, cualquier dibujo; en las rayadas, una mancha negra o un hueco blanco.
    zonas.forEach(function (z) {
      z.s = solido(Id, W, kN, z.xa, z.ya, z.xb, z.yb); z.w = z.osc ? solido(Il, W, kB, z.xa, z.ya, z.xb, z.yb) : 0;
      z.ocupada = z.osc ? (z.s > 0.12 || z.w > 0.004) : z.d >= 0.03;
      z.e = encerrado(m, W, Math.round(z.f * cw) + 1, Math.round(z.r * ch) + 1, Math.round((z.f + 1) * cw) - 1, Math.round((z.r + 1) * ch) - 1);
    });
    // Color: una blanca tiene mucho blanco encerrado y poco negro macizo; una negra, al revés.
    // El corte se busca en cada imagen, en el salto más grande (siempre hay un rey de cada color).
    zonas.forEach(function (z) { z.p = 3 * z.e - (z.d ? z.s / z.d : 0); });
    var ps = zonas.filter(function (z) { return z.ocupada; }).map(function (z) { return z.p; }).sort(function (a, b) { return a - b; });
    var corte = -0.3, salto = 0;
    for (var i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] > salto) { salto = ps[i] - ps[i - 1]; corte = (ps[i] + ps[i - 1]) / 2; }
    var filas = ['', '', '', '', '', '', '', ''];
    zonas.forEach(function (z) { filas[z.r] += !z.ocupada ? '.' : z.p > corte ? 'B' : 'N'; });
    return filas;
  }

  // ---------- leer con IA + control ----------
  // Recorte que se manda a la IA: el tablero con un poco del texto de arriba y de abajo.
  function recorte(c, caja, conTexto) {
    var mx = conTexto ? caja.w * 0.06 : 0, arriba = conTexto ? caja.h * 0.45 : 0, abajo = conTexto ? caja.h * 0.18 : 0;
    var x0 = Math.max(0, Math.round(caja.x - mx)), y0 = Math.max(0, Math.round(caja.y - arriba));
    var x1 = Math.min(c.width, Math.round(caja.x + caja.w + mx)), y1 = Math.min(c.height, Math.round(caja.y + caja.h + abajo));
    var esc = Math.min(1, 1000 / Math.max(x1 - x0, y1 - y0));
    var t = document.createElement('canvas'); t.width = Math.round((x1 - x0) * esc); t.height = Math.round((y1 - y0) * esc);
    var x = t.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height);
    x.drawImage(c, x0, y0, x1 - x0, y1 - y0, 0, 0, t.width, t.height);
    return t;
  }
  function colorDe(ch) { return ch === '.' ? '.' : ch === ch.toUpperCase() ? 'B' : 'N'; }
  function casilla(r, f, negrasAbajo) { return negrasAbajo ? FILES[7 - f] + (r + 1) : FILES[f] + (8 - r); }
  function filasValidas(fs) { return Array.isArray(fs) && fs.length === 8 && fs.every(function (s) { return /^[KQRBNPkqrbnp.]{8}$/.test(s); }); }

  function leer(c, caja) {
    var local = leerLocal(c, caja);
    var img = recorte(c, caja, !caja.entera).toDataURL('image/png').split(',')[1];
    return Datos.leerDiagrama(img, 'image/png').then(function (ia) {
      if (!ia || !filasValidas(ia.filas)) throw new Error('La IA devolvió una posición incompleta.');
      var negrasAbajo = ia.abajo === 'negras', dif = [];
      if (local) for (var r = 0; r < 8; r++) for (var f = 0; f < 8; f++) if (colorDe(ia.filas[r][f]) !== local[r][f]) dif.push(casilla(r, f, negrasAbajo));
      // Si casi nada coincide, el lector propio no entiende este estilo de dibujo: no se usa.
      var controlado = !!local && dif.length <= 6;
      var dudas = (ia.dudosas || []).filter(function (s) { return /^[a-h][1-8]$/.test(s); });
      if (controlado) dif.forEach(function (s) { if (dudas.indexOf(s) < 0) dudas.push(s); });
      var filas = negrasAbajo ? ia.filas.slice().reverse().map(function (s) { return s.split('').reverse().join(''); }) : ia.filas;
      var r = resultado(filas, ia.turno, ia.titulo || '', dudas.sort(), 'ia', controlado ? '' : 'No pude controlar la lectura casilla por casilla: revisala con cuidado.');
      r.girado = negrasAbajo;
      return r;
    }, function (e) {
      if (!local) local = ['........', '........', '........', '........', '........', '........', '........', '........'];
      var filas = local.map(function (s) { return s.replace(/B/g, 'P').replace(/N/g, 'p'); }), dudas = [];
      local.forEach(function (s, r) { s.split('').forEach(function (ch, f) { if (ch !== '.') dudas.push(casilla(r, f, false)); }); });
      var r = resultado(filas, '?', '', dudas, 'local', (e && e.message ? e.message + ' ' : '') +
        'Solo pude ver dónde hay piezas y de qué color; puse peones en su lugar: hay que indicar qué pieza es cada una.');
      r.error = e && e.message ? e.message : 'No se pudo leer con IA.';
      return r;
    });
  }
  function resultado(filas, turno, titulo, dudas, fuente, aviso) {
    return { girado: false, filas: filas, turno: turno === 'b' ? 'b' : turno === 'w' ? 'w' : '?', titulo: titulo, dudas: dudas, fuente: fuente, aviso: aviso, fen: armarFen(filas, turno) };
  }

  // filas: de la 8 a la 1, con letras FEN y '.' para vacía.
  function armarFen(filas, turno) {
    var pos = filas.map(function (s) { return s.replace(/\.+/g, function (v) { return v.length; }); }).join('/');
    var at = function (sq) { return filas[8 - +sq[1]][FILES.indexOf(sq[0])]; };
    var enr = (at('e1') === 'K' && at('h1') === 'R' ? 'K' : '') + (at('e1') === 'K' && at('a1') === 'R' ? 'Q' : '') +
      (at('e8') === 'k' && at('h8') === 'r' ? 'k' : '') + (at('e8') === 'k' && at('a8') === 'r' ? 'q' : '');
    return pos + ' ' + (turno === 'b' ? 'b' : 'w') + ' ' + (enr || '-') + ' - 0 1';
  }
  function filasDeFen(fen) {
    return fen.split(' ')[0].split('/').map(function (s) { return s.replace(/\d/g, function (n) { return '.'.repeat(+n); }); });
  }

  return { abrir: abrir, delPortapapeles: delPortapapeles, buscar: buscar, ajustar: ajustar, leerLocal: leerLocal, recorte: recorte, leer: leer, armarFen: armarFen, filasDeFen: filasDeFen };
})();
