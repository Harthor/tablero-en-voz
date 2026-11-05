// Tablero en Voz · capa de datos compartida por la página del alumno y el panel del profesor.
// Dos modos con la misma interfaz:
//   'nube'  Supabase (cuentas, clases y audios compartidos entre computadoras)
//   'demo'  todo en este navegador (localStorage); se activa con ?demo en la dirección
(function () {
  var SUPABASE_URL = 'https://dtnjvkkemnlkhnywtbvz.supabase.co';
  var SUPABASE_KEY = 'sb_publishable_eRJW53Vx1sro8aPt_sPCVQ_eLMsde01'; // clave pública: es seguro que esté acá
  var SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/dist/umd/supabase.min.js';

  var demo = /[?&]demo\b/.test(location.search);
  var D = window.Datos = { modo: demo ? 'demo' : 'nube' };

  // Base de las páginas (sirve igual en GitHub Pages, en un servidor local o abriendo el archivo).
  var base = location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');
  D.linkInvitacion = function (codigo) { return base + '?invitacion=' + encodeURIComponent(codigo) + (demo ? '&demo' : ''); };
  D.linkProfesor = function () { return base + 'profesor.html' + (demo ? '?demo' : ''); };
  D.nuevoId = function () { return (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); };

  function fail(e) { throw (e && e.message) ? new Error(traducir(e.message)) : e; }
  function traducir(m) {
    if (/Invalid login credentials/i.test(m)) return 'El email o la contraseña no coinciden.';
    if (/Email not confirmed/i.test(m)) return 'Todavía no confirmaste el email: buscá el mensaje de Supabase en tu correo (mirá también en spam).';
    if (/User already registered/i.test(m)) return 'Ya hay una cuenta con ese email. Usá “Entrar”.';
    if (/Password should be at least/i.test(m)) return 'La contraseña tiene que tener al menos 6 caracteres.';
    if (/invitacion_invalida/.test(m)) return 'Ese link de invitación ya no sirve. Pedile a tu profesor uno nuevo.';
    if (/Anonymous sign-ins are disabled/i.test(m)) return 'Falta activar el ingreso de alumnos en Supabase (Allow anonymous sign-ins).';
    if (/rate limit/i.test(m)) return 'Supabase está limitando los pedidos (demasiados mails o intentos seguidos). Esperá un rato y probá de nuevo.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'No hay conexión con el servidor. Revisá internet y probá de nuevo.';
    return m;
  }

  function errorIA(m) {
    if (/sin_sesion/.test(m)) return 'Para leer imágenes con IA hay que entrar: el profesor con su cuenta, el alumno con el link de su profesor.';
    if (/sin_permiso_ia/.test(m)) return 'Esta cuenta no puede usar la lectura con IA. El alumno tiene que entrar con el link de su profesor.';
    if (/limite_ia/.test(m)) return 'Se llegó al máximo de lecturas con IA por hoy. Mañana se puede seguir.';
    if (/sin_clave_ia/.test(m)) return 'Falta configurar la clave de la IA en Supabase (secreto ANTHROPIC_API_KEY).';
    if (/Failed to send|Function not found|404/i.test(m)) return 'Falta instalar la función leer-diagrama en Supabase.';
    return m;
  }

  // ======================= modo nube (Supabase) =======================
  function nube() {
    var sb = null;
    D.listo = new Promise(function (ok) {
      var s = document.createElement('script'); s.src = SUPABASE_JS;
      s.onload = function () { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY); ok(true); };
      s.onerror = function () { ok(false); };
      document.head.appendChild(s);
    });
    function cli() { return D.listo.then(function (ok) { if (!ok) throw new Error('No se pudo cargar la conexión con el servidor. Revisá internet y recargá.'); return sb; }); }
    function q(p) { return p.then(function (r) { if (r.error) fail(r.error); return r.data; }); }

    D.usuario = function () {
      return D.listo.then(function (ok) {
        if (!ok) return null;
        return sb.auth.getSession().then(function (r) {
          var u = r.data.session && r.data.session.user; if (!u) return null;
          return { id: u.id, email: u.email || '', anonimo: !!u.is_anonymous, nombre: (u.user_metadata && u.user_metadata.nombre) || '' };
        });
      });
    };
    D.registrar = function (email, pass, nombre) {
      return cli().then(function (sb) {
        return sb.auth.signUp({ email: email, password: pass, options: { data: { nombre: nombre }, emailRedirectTo: D.linkProfesor() } });
      }).then(function (r) { if (r.error) fail(r.error); return { necesitaConfirmar: !r.data.session }; });
    };
    D.entrar = function (email, pass) {
      return cli().then(function (sb) { return sb.auth.signInWithPassword({ email: email, password: pass }); })
        .then(function (r) { if (r.error) fail(r.error); });
    };
    D.salir = function () { return cli().then(function (sb) { return sb.auth.signOut(); }); };
    D.alCambiarSesion = function (fn) { D.listo.then(function (ok) { if (ok) sb.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') fn(ev); }); }); };

    // Perfil de profesor: lo crea la primera vez que entra una cuenta con email.
    D.perfil = function () {
      return D.usuario().then(function (u) {
        if (!u || u.anonimo) return null;
        return q(sb.from('profesores').select('id,nombre').eq('id', u.id).maybeSingle()).then(function (p) {
          if (p) return p;
          return q(sb.from('profesores').insert({ id: u.id, nombre: u.nombre || u.email.split('@')[0] }).select('id,nombre').single());
        });
      });
    };
    D.guardarPerfil = function (nombre) { return D.usuario().then(function (u) { return q(sb.from('profesores').update({ nombre: nombre }).eq('id', u.id)); }); };

    D.alumnos = function () {
      return q(sb.from('alumnos').select('id,nombre,codigo,creado,dispositivos(usuario_id)').order('creado')).then(function (rows) {
        return rows.map(function (a) { return { id: a.id, nombre: a.nombre, codigo: a.codigo, dispositivos: (a.dispositivos || []).length }; });
      });
    };
    D.crearAlumno = function (nombre) { return D.usuario().then(function (u) { return q(sb.from('alumnos').insert({ profesor_id: u.id, nombre: nombre }).select('id,nombre,codigo').single()); }); };
    D.borrarAlumno = function (id) { return q(sb.from('alumnos').delete().eq('id', id)); };
    D.nuevoCodigo = function (id) {
      var c = D.nuevoId().replace(/-/g, '').slice(0, 16);
      // Cambiar el código invalida el link viejo; los dispositivos ya vinculados se desvinculan.
      return q(sb.from('alumnos').update({ codigo: c }).eq('id', id)).then(function () { return q(sb.from('dispositivos').delete().eq('alumno_id', id)); }).then(function () { return c; });
    };

    D.clases = function () { return D.usuario().then(function (u) { return q(sb.from('clases').select('id,titulo,capitulos,actualizado').eq('profesor_id', u.id).order('creado')); }); };
    D.guardarClase = function (c) {
      return D.usuario().then(function (u) {
        var row = { id: c.id, profesor_id: u.id, titulo: c.titulo, capitulos: c.capitulos, actualizado: new Date().toISOString() };
        return q(sb.from('clases').upsert(row).select('id,titulo,capitulos,actualizado').single());
      });
    };
    D.borrarClase = function (id) { return q(sb.from('clases').delete().eq('id', id)); };
    D.asignaciones = function () { return q(sb.from('asignaciones').select('clase_id,alumno_id')); };
    D.asignar = function (claseId, alumnoId, si) {
      return si ? q(sb.from('asignaciones').upsert({ clase_id: claseId, alumno_id: alumnoId }))
                : q(sb.from('asignaciones').delete().eq('clase_id', claseId).eq('alumno_id', alumnoId));
    };
    D.progresos = function () { return q(sb.from('progreso').select('alumno_id,clase_id,datos,actualizado')); };

    D.subirAudio = function (blob, ext) {
      return D.usuario().then(function (u) {
        var path = u.id + '/' + D.nuevoId() + '.' + ext;
        return q(sb.storage.from('audios').upload(path, blob, { contentType: blob.type.split(';')[0] })).then(function () { return path; });
      });
    };
    var urls = {};
    D.urlAudio = function (path) {
      var c = urls[path]; if (c && c.vence > Date.now()) return Promise.resolve(c.url);
      return cli().then(function (sb) { return q(sb.storage.from('audios').createSignedUrl(path, 3600)); })
        .then(function (d) { urls[path] = { url: d.signedUrl, vence: Date.now() + 3000 * 1000 }; return d.signedUrl; });
    };
    D.borrarAudio = function (path) { return q(sb.storage.from('audios').remove([path])); };

    // ---------- alumno ----------
    D.canjear = function (codigo) {
      return cli().then(function (sb) {
        return sb.auth.getSession().then(function (r) {
          if (r.data.session) return;
          return sb.auth.signInAnonymously().then(function (r) { if (r.error) fail(r.error); });
        });
      }).then(function () { return q(sb.rpc('canjear_invitacion', { p_codigo: codigo })); });
    };
    D.miAlumno = function () {
      return D.usuario().then(function (u) {
        if (!u) return null;
        return q(sb.from('dispositivos').select('alumnos(id,nombre,profesores(nombre))').eq('usuario_id', u.id).maybeSingle()).then(function (d) {
          if (!d || !d.alumnos) return null;
          return { id: d.alumnos.id, nombre: d.alumnos.nombre, profesor: d.alumnos.profesores ? d.alumnos.profesores.nombre : '' };
        });
      });
    };
    D.misClases = function (alumnoId) {
      return q(sb.from('asignaciones').select('creado,clases(id,titulo,capitulos,actualizado)').eq('alumno_id', alumnoId).order('creado'))
        .then(function (rows) { return rows.map(function (r) { return r.clases; }).filter(Boolean); });
    };
    D.progreso = function (alumnoId) {
      return q(sb.from('progreso').select('clase_id,datos').eq('alumno_id', alumnoId)).then(function (rows) {
        var m = {}; rows.forEach(function (r) { m[r.clase_id] = r.datos; }); return m;
      });
    };
    D.guardarProgreso = function (alumnoId, claseId, datos) {
      return q(sb.from('progreso').upsert({ alumno_id: alumnoId, clase_id: claseId, datos: datos, actualizado: new Date().toISOString() }));
    };

    // Lectura de un diagrama con IA (función "leer-diagrama" de Supabase).
    D.leerDiagrama = function (base64, tipo) {
      return cli().then(function (sb) {
        return sb.auth.getSession().then(function (r) {
          if (!r.data.session) throw new Error('sin_sesion');
          return sb.functions.invoke('leer-diagrama', { body: { imagen: base64, tipo: tipo } });
        });
      }).then(function (r) {
        if (!r.error) return r.data;
        var ctx = r.error.context;
        return (ctx && ctx.json ? ctx.json().catch(function () { return {}; }) : Promise.resolve({})).then(function (j) {
          throw new Error(j.error || r.error.message || 'No se pudo leer la imagen.');
        });
      }).catch(function (e) { fail(new Error(errorIA(e.message))); });
    };
  }

  // ======================= modo demo (este navegador) =======================
  function local() {
    var KEY = 'tev_demo_db';
    function leer() { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch (e) { return null; } }
    function db() { return leer() || { sesion: null, cuentas: {}, profesores: {}, alumnos: [], dispositivo: null, clases: [], asignaciones: [], progreso: {}, audios: {} }; }
    function grabar(d) {
      try { localStorage.setItem(KEY, JSON.stringify(d)); }
      catch (e) { throw new Error('El modo demo se quedó sin espacio en este navegador (los audios ocupan mucho). Borrá algunos audios o usá la versión con cuenta.'); }
    }
    function tx(fn) { return Promise.resolve().then(function () { var d = db(); var r = fn(d); grabar(d); return r; }); }
    function ver(fn) { return Promise.resolve().then(function () { return fn(db()); }); }
    function copia(x) { return JSON.parse(JSON.stringify(x)); }
    function yo(d) { if (!d.sesion) throw new Error('Tenés que entrar primero.'); return d.sesion; }
    function now() { return new Date().toISOString(); }

    D.listo = Promise.resolve(true);
    D.usuario = function () { return ver(function (d) { var c = d.sesion && d.cuentas[d.sesion]; return c ? { id: c.id, email: d.sesion, anonimo: false, nombre: c.nombre } : null; }); };
    D.registrar = function (email, pass, nombre) {
      return tx(function (d) {
        if (d.cuentas[email]) throw new Error('Ya hay una cuenta con ese email. Usá “Entrar”.');
        if (pass.length < 6) throw new Error('La contraseña tiene que tener al menos 6 caracteres.');
        d.cuentas[email] = { id: D.nuevoId(), pass: pass, nombre: nombre }; d.sesion = email; return { necesitaConfirmar: false };
      });
    };
    D.entrar = function (email, pass) { return tx(function (d) { var c = d.cuentas[email]; if (!c || c.pass !== pass) throw new Error('El email o la contraseña no coinciden.'); d.sesion = email; }); };
    D.salir = function () { return tx(function (d) { d.sesion = null; }); };
    D.alCambiarSesion = function () {};
    D.perfil = function () {
      return tx(function (d) {
        if (!d.sesion) return null; var c = d.cuentas[d.sesion];
        if (!d.profesores[c.id]) d.profesores[c.id] = { id: c.id, nombre: c.nombre || d.sesion.split('@')[0] };
        return copia(d.profesores[c.id]);
      });
    };
    D.guardarPerfil = function (nombre) { return tx(function (d) { d.profesores[d.cuentas[yo(d)].id].nombre = nombre; }); };
    function pid(d) { return d.cuentas[yo(d)].id; }

    D.alumnos = function () {
      return ver(function (d) {
        var p = pid(d);
        return d.alumnos.filter(function (a) { return a.profesor_id === p; })
          .map(function (a) { return { id: a.id, nombre: a.nombre, codigo: a.codigo, dispositivos: d.dispositivo === a.id ? 1 : 0 }; });
      });
    };
    D.crearAlumno = function (nombre) {
      return tx(function (d) { var a = { id: D.nuevoId(), profesor_id: pid(d), nombre: nombre, codigo: D.nuevoId().replace(/-/g, '').slice(0, 16) }; d.alumnos.push(a); return copia(a); });
    };
    D.borrarAlumno = function (id) {
      return tx(function (d) {
        d.alumnos = d.alumnos.filter(function (a) { return a.id !== id; });
        d.asignaciones = d.asignaciones.filter(function (s) { return s.alumno_id !== id; });
        delete d.progreso[id]; if (d.dispositivo === id) d.dispositivo = null;
      });
    };
    D.nuevoCodigo = function (id) {
      return tx(function (d) { var a = d.alumnos.find(function (x) { return x.id === id; }); a.codigo = D.nuevoId().replace(/-/g, '').slice(0, 16); if (d.dispositivo === id) d.dispositivo = null; return a.codigo; });
    };
    D.clases = function () { return ver(function (d) { var p = pid(d); return copia(d.clases.filter(function (c) { return c.profesor_id === p; })); }); };
    D.guardarClase = function (c) {
      return tx(function (d) {
        var row = { id: c.id || D.nuevoId(), profesor_id: pid(d), titulo: c.titulo, capitulos: copia(c.capitulos), actualizado: now() };
        var i = d.clases.findIndex(function (x) { return x.id === row.id; });
        if (i < 0) d.clases.push(row); else d.clases[i] = row;
        return copia(row);
      });
    };
    D.borrarClase = function (id) {
      return tx(function (d) {
        d.clases = d.clases.filter(function (c) { return c.id !== id; });
        d.asignaciones = d.asignaciones.filter(function (s) { return s.clase_id !== id; });
      });
    };
    D.asignaciones = function () { return ver(function (d) { return copia(d.asignaciones); }); };
    D.asignar = function (claseId, alumnoId, si) {
      return tx(function (d) {
        d.asignaciones = d.asignaciones.filter(function (s) { return !(s.clase_id === claseId && s.alumno_id === alumnoId); });
        if (si) d.asignaciones.push({ clase_id: claseId, alumno_id: alumnoId, creado: now() });
      });
    };
    D.progresos = function () {
      return ver(function (d) {
        var out = [];
        Object.keys(d.progreso).forEach(function (a) { Object.keys(d.progreso[a]).forEach(function (c) { out.push({ alumno_id: a, clase_id: c, datos: d.progreso[a][c], actualizado: d.progreso[a][c].fecha || '' }); }); });
        return out;
      });
    };
    D.subirAudio = function (blob) {
      return new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(r.result); }; r.onerror = ko; r.readAsDataURL(blob); })
        .then(function (url) { return tx(function (d) { var id = 'demo/' + D.nuevoId(); d.audios[id] = url; return id; }); });
    };
    D.urlAudio = function (path) { return ver(function (d) { if (!d.audios[path]) throw new Error('No encuentro ese audio.'); return d.audios[path]; }); };
    D.borrarAudio = function (path) { return tx(function (d) { delete d.audios[path]; }); };

    D.canjear = function (codigo) {
      return tx(function (d) {
        var a = d.alumnos.find(function (x) { return x.codigo === codigo; });
        if (!a) throw new Error('Ese link de invitación ya no sirve. Pedile a tu profesor uno nuevo.');
        d.dispositivo = a.id;
        return { id: a.id, nombre: a.nombre, profesor: (d.profesores[a.profesor_id] || {}).nombre || '' };
      });
    };
    D.miAlumno = function () {
      return ver(function (d) {
        var a = d.alumnos.find(function (x) { return x.id === d.dispositivo; }); if (!a) return null;
        return { id: a.id, nombre: a.nombre, profesor: (d.profesores[a.profesor_id] || {}).nombre || '' };
      });
    };
    D.misClases = function (alumnoId) {
      return ver(function (d) {
        return d.asignaciones.filter(function (s) { return s.alumno_id === alumnoId; })
          .map(function (s) { return copia(d.clases.find(function (c) { return c.id === s.clase_id; })); }).filter(Boolean);
      });
    };
    D.progreso = function (alumnoId) { return ver(function (d) { return copia(d.progreso[alumnoId] || {}); }); };
    D.guardarProgreso = function (alumnoId, claseId, datos) {
      return tx(function (d) { d.progreso[alumnoId] = d.progreso[alumnoId] || {}; datos = copia(datos); datos.fecha = now(); d.progreso[alumnoId][claseId] = datos; });
    };
    // En el modo demo no hay IA: la página usa solo el lector propio.
    D.leerDiagrama = function () { return Promise.reject(new Error('En el modo demo no hay lectura con IA.')); };
  }

  if (demo) local(); else nube();
})();
