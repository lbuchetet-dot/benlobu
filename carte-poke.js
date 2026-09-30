/* ══════════════════════════════════════════════════════════════════════════════
   CARTE POKÉ — lecture commune du modèle de carte (site pokeben.fr, caisse, admin)
   ──────────────────────────────────────────────────────────────────────────────
   Une seule source de vérité pour interpréter ce que l'admin écrit dans Firebase :
     cartes/<carte>/produits/<id>.tailles = { "M Saumon": {prix, taille:"M", proteine:"Saumon"} … }
     parametres/grille_tailles/<carte>   = [{nom:"S",supp:0},{nom:"M",supp:3},{nom:"L",supp:6}]
     parametres/sauces/<carte>           = {liste:[…], prix_extra:0.5}     (1 sauce incluse)
     cartes/<carte>/formules/<id>        = {nom, prix, actif, slots:[{label,mode,produits,categorieAuto}]}

   Règles de prix (identiques partout) :
     · bowl seul  = prix de la variante (taille × protéine) + suppléments + sauces en plus
     · en menu    = prix du menu + (prix variante − prix mini du produit) + suppléments + sauces en plus
     · sauces     : la première est incluse, chaque suivante coûte prix_extra

   Chargé par <script src="/carte-poke.js"> (global window.CartePoke) ; testable en Node.
   Toute évolution du modèle se fait ICI, puis se propage aux trois applications.
   ══════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var TAILLES_FALLBACK = ['s', 'm', 'l', 'xl', 'petit', 'moyen', 'grand', 'unique'];

  function norm(s) { return String(s == null ? '' : s).trim(); }
  function low(s) { return norm(s).toLowerCase(); }
  function num(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

  // ── Grille de tailles ─────────────────────────────────────────────────────
  // grille : tableau [{nom, supp}] (parametres.grille_tailles.<carte>) ; tolère undefined
  function grille(parametres, carte) {
    var g = ((parametres || {}).grille_tailles || {})[carte || 'poke'];
    return Array.isArray(g) ? g : [];
  }
  function rangTaille(t, g) {
    var k = low(t);
    var noms = (g || []).map(function (x) { return low(x && x.nom); });
    var i = noms.indexOf(k); if (i >= 0) return i;
    i = TAILLES_FALLBACK.indexOf(k); return i < 0 ? 99 : i;
  }
  // « L Saumon » → {taille:"L", proteine:"Saumon"} pour les produits saisis avant le nouvel admin
  function deduireAxes(nom, g) {
    var parts = norm(nom).split(/\s+/);
    if (parts.length > 1 && rangTaille(parts[0], g) < 99) return { taille: parts[0], proteine: parts.slice(1).join(' ') };
    return { taille: norm(nom), proteine: '' };
  }

  // ── Variantes d'un produit ────────────────────────────────────────────────
  // → [{nom (clé Firebase), prix, taille, proteine}] triées S → M → L puis prix croissant
  function variantes(prod, g) {
    var out = [];
    var t = (prod && prod.tailles) || {};
    Object.keys(t).forEach(function (k) {
      var v = t[k] || {};
      var px = Number(v.prix); if (isNaN(px)) return;
      var ta = norm(v.taille), pt = norm(v.proteine);
      if (!ta && !pt) { var d = deduireAxes(k, g); ta = d.taille; pt = d.proteine; }
      out.push({ nom: k, prix: px, taille: ta, proteine: pt });
    });
    out.sort(function (a, b) { var d = rangTaille(a.taille, g) - rangTaille(b.taille, g); return d !== 0 ? d : a.prix - b.prix; });
    return out;
  }
  // Valeurs distinctes d'un axe ('taille' | 'proteine'), dans l'ordre des variantes
  function axe(prod, champ, g) {
    var out = [];
    variantes(prod, g).forEach(function (v) { var x = v[champ] || ''; if (x && out.indexOf(x) < 0) out.push(x); });
    return out;
  }
  function variante(prod, taille, proteine, g) {
    var vs = variantes(prod, g);
    var hit = null;
    vs.forEach(function (v) { if (!hit && (v.taille || '') === norm(taille) && (v.proteine || '') === norm(proteine)) hit = v; });
    if (!hit && vs.length === 1) hit = vs[0];
    return hit;
  }
  function prixMin(prod, g) {
    var vs = variantes(prod, g);
    if (!vs.length) return num(prod && prod.prix);
    return vs.reduce(function (m, v) { return v.prix < m ? v.prix : m; }, vs[0].prix);
  }
  function estBowl(prod) { return /pok|bowl/i.test((prod && (prod.categorie || prod.cat)) || ''); }
  function estSauceCat(cat) { return /sauce/i.test(cat || ''); }

  // ── Sauces communes à la carte ────────────────────────────────────────────
  function sauces(parametres, carte) {
    var sc = ((parametres || {}).sauces || {})[carte || 'poke'] || {};
    return { liste: Array.isArray(sc.liste) ? sc.liste : [], prixExtra: num(sc.prix_extra) };
  }
  function prixSauces(nb, prixExtra) { return Math.max(0, num(nb) - 1) * num(prixExtra); }
  // Libellé d'une sauce dans les suppléments : « Sauce sucrée » → « Sauce sucrée », « Spicy Mayo » → « Sauce Spicy Mayo »
  function labelSauce(nom) { return 'Sauce ' + norm(nom).replace(/^sauce\s+/i, ''); }
  // Sauces choisies → lignes de suppléments (première incluse)
  function saucesEnSupplements(choisies, prixExtra) {
    return (choisies || []).map(function (s, i) { return { nom: labelSauce(s), prix: i === 0 ? 0 : num(prixExtra), sauce: true }; });
  }

  // ── Formules / menus ──────────────────────────────────────────────────────
  function formulesActives(formulesNode) {
    var f = formulesNode || {};
    return Object.keys(f).map(function (id) {
      var x = f[id]; if (!x || x.actif === false) return null;
      var slots = (x.slots || []).map(function (sl) {
        return { label: sl.label || '', mode: sl.mode || 'choix', produits: sl.produits || [], categorieAuto: sl.categorieAuto || '' };
      });
      if (!slots.length) return null;
      return { id: id, nom: x.nom || 'Menu', prix: num(x.prix), description: x.description || '', slots: slots };
    }).filter(Boolean);
  }
  // Produits éligibles d'un emplacement (produits = map brute cartes/<carte>/produits)
  function produitsSlot(sl, produits) {
    var P = produits || {};
    if (sl.categorieAuto) {
      return Object.keys(P).filter(function (id) { var p = P[id]; return p && p.actif !== false && (p.categorie || 'Autres') === sl.categorieAuto; });
    }
    return (sl.produits || []).filter(function (id) { return P[id] && P[id].actif !== false; });
  }
  function premierSlot(f) { var hit = null; (f.slots || []).forEach(function (sl) { if (!hit && sl.mode !== 'fixe') hit = sl; }); return hit; }
  // Formules dont le plat (premier emplacement au choix) accepte ce produit
  function formulesPour(prodId, formules, produits) {
    return (formules || []).filter(function (f) { var sl = premierSlot(f); return sl && produitsSlot(sl, produits).indexOf(prodId) >= 0; });
  }
  // Emplacements que le client doit choisir : ni le plat, ni les imposés, ni la sauce (= celle du bowl)
  function slotsMenu(f, produits) {
    var out = [], premierVu = false;
    (f.slots || []).forEach(function (sl, si) {
      if (sl.mode === 'fixe') return;
      if (!premierVu) { premierVu = true; return; }
      if (/sauce/i.test(sl.label || '')) return;
      var ids = produitsSlot(sl, produits);
      if (ids.length && ids.every(function (id) { return estSauceCat((produits[id] || {}).categorie); })) return;
      out.push({ si: si, sl: sl });
    });
    return out;
  }
  // Prix « à la carte » des emplacements à choisir (produit le moins cher de chacun) — pour afficher l'économie
  function prixSlotsALaCarte(f, produits, g) {
    return slotsMenu(f, produits).reduce(function (a, x) {
      var mins = produitsSlot(x.sl, produits).map(function (id) { return prixMin(produits[id], g); }).filter(function (v) { return v > 0; });
      return a + (mins.length ? Math.min.apply(null, mins) : 0);
    }, 0);
  }

  // ── Prix ──────────────────────────────────────────────────────────────────
  // ctx = {prixVariante, prixMinProduit, supplements:[{prix}], nbSauces, prixExtraSauce}
  function totalSupplements(sups) { return (sups || []).reduce(function (a, s) { return a + num(s && s.prix); }, 0); }
  function prixSeul(ctx) { return arr(num(ctx.prixVariante) + totalSupplements(ctx.supplements) + prixSauces(ctx.nbSauces, ctx.prixExtraSauce)); }
  function ecartVariante(ctx) { return Math.max(0, num(ctx.prixVariante) - num(ctx.prixMinProduit)); }
  function prixMenu(f, ctx) { return arr(num(f.prix) + ecartVariante(ctx) + totalSupplements(ctx.supplements) + prixSauces(ctx.nbSauces, ctx.prixExtraSauce)); }
  function arr(n) { return Math.round(n * 100) / 100; }

  // ── Composition d'un menu (ligne transmise au panier, à la caisse, au bon) ──
  // v = variante du bowl ; sups = suppléments + sauces déjà convertis ; sel = {slotIndex: prodId}
  function composition(f, prod, prodId, v, sups, sel, produits, g) {
    var P = produits || {};
    var multi = axe(prod, 'taille', g).length > 1 || axe(prod, 'proteine', g).length > 1;
    var supsTot = totalSupplements(sups);
    var supsLbl = (sups || []).map(function (s) { return s.nom; }).join(', ');
    var out = [], premierVu = false;
    (f.slots || []).forEach(function (sl, si) {
      if (sl.mode === 'fixe') {
        var pid = produitsSlot(sl, P)[0];
        if (pid) out.push({ label: sl.label, prodId: String(pid), nom: (P[pid] || {}).nom || pid, taille: '', ecart: 0 });
        return;
      }
      if (!premierVu) {
        premierVu = true;
        out.push({ label: sl.label, prodId: String(prodId),
          nom: (prod.nom || '') + (multi && v ? ' ' + v.nom : '') + (supsLbl ? ' (' + supsLbl + ')' : ''),
          taille: v ? v.nom : '', proteine: v ? (v.proteine || '') : '', supplements: sups || [],
          ecart: (v ? Math.max(0, v.prix - prixMin(prod, g)) : 0) + supsTot });
        return;
      }
      if (/sauce/i.test(sl.label || '')) return;
      var choix = sel && sel[si]; if (!choix) return;
      out.push({ label: sl.label, prodId: String(choix), nom: (P[choix] || {}).nom || choix, taille: '', ecart: 0 });
    });
    return out;
  }

  var CartePoke = {
    VERSION: '1.0.0',
    grille: grille, rangTaille: rangTaille, deduireAxes: deduireAxes,
    variantes: variantes, axe: axe, variante: variante, prixMin: prixMin, estBowl: estBowl,
    sauces: sauces, prixSauces: prixSauces, labelSauce: labelSauce, saucesEnSupplements: saucesEnSupplements,
    formulesActives: formulesActives, produitsSlot: produitsSlot, premierSlot: premierSlot,
    formulesPour: formulesPour, slotsMenu: slotsMenu, prixSlotsALaCarte: prixSlotsALaCarte,
    totalSupplements: totalSupplements, prixSeul: prixSeul, ecartVariante: ecartVariante, prixMenu: prixMenu,
    composition: composition
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = CartePoke;
  root.CartePoke = CartePoke;
})(typeof window !== 'undefined' ? window : globalThis);
