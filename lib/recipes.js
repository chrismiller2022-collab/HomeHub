// Read a recipe from a link. Nearly every recipe site (NYT Cooking, Allrecipes, Serious Eats, food
// blogs…) embeds schema.org/Recipe JSON-LD for Google, which carries the title, ingredients,
// servings and times. When a page has none, we fall back to its title so the meal can still be
// planned, and the assistant asks for ingredients instead.

var MAX_BYTES = 3 * 1024 * 1024;

// Refuse obvious internal targets: this runs on our server, with a URL someone texted in.
export function safeRecipeUrl(raw) {
  var u;
  try { u = new URL(String(raw).trim()); } catch (e) { throw new Error('That doesn’t look like a link'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Only web links are supported');
  var h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || h === 'metadata.google.internal' ||
      /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.indexOf(':') > -1 || /^\d+$/.test(h)) {
    throw new Error('That link points somewhere private');
  }
  return u.toString();
}

function asArray(x) { return x == null ? [] : Array.isArray(x) ? x : [x]; }
function text(x) {
  if (x == null) return '';
  if (typeof x === 'string') return decodeEntities(x.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (typeof x === 'object') return text(x.text || x.name || '');
  return String(x);
}
function decodeEntities(s) {
  return s.replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|apos|nbsp|#39);/gi, function (m, e) {
    var map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
    if (map[e.toLowerCase()]) return map[e.toLowerCase()];
    var code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code ? String.fromCodePoint(code) : m;
  });
}
// "PT1H15M" -> "1 hr 15 min"
function duration(iso) {
  var m = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?/i.exec(iso || '');
  if (!m || (!m[1] && !m[2])) return null;
  return [m[1] ? m[1] + ' hr' : '', m[2] ? m[2] + ' min' : ''].filter(Boolean).join(' ');
}

function findRecipe(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) { var r = findRecipe(node[i]); if (r) return r; }
    return null;
  }
  if (asArray(node['@type']).some(function (t) { return String(t).toLowerCase() === 'recipe'; })) return node;
  return findRecipe(node['@graph']) || findRecipe(node.mainEntity) || null;
}

export function parseRecipeHtml(html, url) {
  var blocks = html.match(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>[\s\S]*?<\/script>/gi) || [];
  for (var i = 0; i < blocks.length; i++) {
    var body = blocks[i].replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    var data;
    try { data = JSON.parse(body); } catch (e) { continue; }
    var r = findRecipe(data);
    if (!r) continue;
    return {
      found: true,
      url: url,
      title: text(r.name) || null,
      ingredients: asArray(r.recipeIngredient || r.ingredients).map(text).filter(Boolean).slice(0, 60),
      servings: text(asArray(r.recipeYield)[0]) || null,
      totalTime: duration(r.totalTime) || duration(r.cookTime) || null,
      description: text(r.description).slice(0, 300) || null
    };
  }
  var og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i.exec(html);
  var t = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return { found: false, url: url, title: og ? decodeEntities(og[1]).trim() : t ? decodeEntities(t[1]).trim() : null, ingredients: [] };
}

export async function fetchRecipe(rawUrl, fetchImpl) {
  var url = safeRecipeUrl(rawUrl), res;
  // Follow redirects by hand so every hop gets the same private-address check.
  for (var hop = 0; ; hop++) {
    res = await (fetchImpl || fetch)(url, {
      redirect: 'manual',
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; HomeHub/1.0; family meal planner)', accept: 'text/html' }
    });
    if (res.status < 300 || res.status >= 400 || !res.headers.get('location')) break;
    if (hop >= 4) throw new Error('Too many redirects');
    url = safeRecipeUrl(new URL(res.headers.get('location'), url).toString());
  }
  if (!res.ok) throw new Error('The recipe site answered ' + res.status);
  var reader = res.body && res.body.getReader ? res.body.getReader() : null;
  var html = '';
  if (reader) {
    var dec = new TextDecoder(), total = 0;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.length;
      html += dec.decode(chunk.value, { stream: true });
      if (total > MAX_BYTES) { reader.cancel().catch(function () {}); break; }
    }
  } else {
    html = (await res.text()).slice(0, MAX_BYTES);
  }
  return parseRecipeHtml(html, url);
}
