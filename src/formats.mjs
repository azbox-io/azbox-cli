/**
 * Serializadores de salida.
 *
 * Dos formatos, que son los que cubren la mayoría de los proyectos que ya
 * usan AZbox: JSON para i18next y compañía, y ARB para Flutter.
 */

/** Convierte claves con puntos en objetos anidados: a.b -> { a: { b } }. */
function nest(entries) {
  const root = {};
  for (const [key, value] of entries) {
    const parts = key.split(".");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      // Si un tramo ya está ocupado por una cadena, anidar lo destruiría.
      // Se deja la clave plana y quien lo lea verá el punto en el nombre.
      if (typeof node[part] !== "object" || node[part] === null) {
        if (part in node) return null;
        node[part] = {};
      }
      node = node[part];
    }
    const leaf = parts[parts.length - 1];
    if (typeof node[leaf] === "object" && node[leaf] !== null) return null;
    node[leaf] = value;
  }
  return root;
}

function flat(entries) {
  return Object.fromEntries(entries);
}

/**
 * @param {[string, string][]} entries
 * @param {{ format: "json"|"arb", nested?: boolean, language?: string }} options
 */
export function serialize(entries, { format, nested = true, language } = {}) {
  if (format === "arb") {
    // ARB es JSON plano con metadatos por clave. Nunca anidado: el generador
    // de Flutter espera las claves al primer nivel.
    const out = { "@@locale": language ?? "und", ...flat(entries) };
    return JSON.stringify(out, null, 2) + "\n";
  }

  if (format === "json") {
    let out = null;
    if (nested) out = nest(entries);
    // nest() devuelve null cuando las claves chocan entre sí (por ejemplo
    // existen "home" y "home.title"): en ese caso plano es lo correcto.
    if (out === null) out = flat(entries);
    return JSON.stringify(out, null, 2) + "\n";
  }

  throw new Error(`Formato no soportado: ${format}`);
}

export const FORMATS = ["json", "arb"];

/** Extensión por defecto de cada formato. */
export const EXTENSIONS = { json: "json", arb: "arb" };

/** ¿Las claves de este conjunto se pueden anidar sin colisiones? */
export function canNest(entries) {
  return nest(entries) !== null;
}
