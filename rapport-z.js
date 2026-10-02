/* ══════════════════════════════════════════════════════════════════════════════
   RAPPORT Z — calcul commun d'un service (caisse : Ticket Z ; admin : rapport comptable)
   ──────────────────────────────────────────────────────────────────────────────
   Entrées (nœuds Firebase bruts) :
     cmdsJour   = commandes/<etab>/<date>        (map)
     annulJour  = annulations/<etab>/<date>      (map)
     fonds      = fonds_caisse/<etab>/<date>     (map {total, heure})
     opts       = { tva:{sur_place,a_emporter}, produits: cartes/<carte>/produits, service:'midi'|'soir',
                    detectService(dateObj) → 'midi'|'soir' (facultatif) }

   Règles (identiques partout) :
     · une commande compte quand statut === 'payee' ; son service = c.service (sinon heure < 16h → midi)
     · paiements : nombre de transactions et montant par mode ; les modes sont normalisés en libellés
     · tickets resto : surplus (tickets > dû) = « avoir émis » (jamais rendu, compta uniquement)
     · TVA : taux du produit (sur place par défaut) ; une remise se répartit au prorata des lignes
     · fond initial = dernier comptage du jour avant la 1re commande du service (sinon le 1er du jour)
   ══════════════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';
  var MODES = { Especes: 'Espèces', Tickets_resto: 'Tickets resto', 'Tickets resto': 'Tickets resto',
                CTR: 'Carte ticket resto', Carte_ticket_resto: 'Carte ticket resto', 'Carte ticket resto': 'Carte ticket resto',
                Cheques: 'Chèques', 'Chèques': 'Chèques', CB: 'Carte bancaire', 'Carte bancaire': 'Carte bancaire',
                Virement: 'Virement' };
  // Ordre d'affichage (comme le tableau comptable) ; les autres modes viennent ensuite
  var ORDRE = ['Carte bancaire', 'Carte ticket resto', 'Espèces', 'Tickets resto', 'Virement', 'Chèques'];
  function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function mode(m) { m = String(m || ''); return MODES[m] || m.replace(/_/g, ' '); }
  function estTR(m) { return /resto/i.test(m); }
  function serviceDe(c, detect) {
    if (c.service) return c.service;
    if (detect && c.timestamp) return detect(new Date(c.timestamp));
    var h = parseInt(String(c.heure || '12').split(':')[0], 10);
    return (isNaN(h) || h < 16) ? 'midi' : 'soir';
  }
  function trier(paiements) {
    var out = {};
    Object.keys(paiements).sort(function (a, b) {
      var ia = ORDRE.indexOf(a), ib = ORDRE.indexOf(b);
      if (ia < 0) ia = 99; if (ib < 0) ib = 99;
      return ia - ib || a.localeCompare(b);
    }).forEach(function (k) { out[k] = paiements[k]; });
    return out;
  }

  function calculer(service, cmdsJour, annulJour, fonds, opts) {
    opts = opts || {};
    var tvaP = opts.tva || { sur_place: 10, a_emporter: 5.5 };
    var produits = opts.produits || {};
    var detect = opts.detectService;
    var toutes = Object.keys(cmdsJour || {}).map(function (k) { return cmdsJour[k]; }).filter(Boolean);
    var du = function (c) { return !service || serviceDe(c, detect) === service; };
    var payees = toutes.filter(function (c) { return c.statut === 'payee' && du(c); });
    var nonSoldees = toutes.filter(function (c) { return (c.statut === 'en_cours' || c.statut === 'non_soldee') && du(c); });
    var ca = r2(payees.reduce(function (s, c) { return s + (c.total || 0); }, 0));
    var nbCmd = payees.length;
    var nbCvt = payees.reduce(function (s, c) { return s + (c.couverts || 0); }, 0);

    var paiements = {}, nbTickets = 0, avNb = 0, avMt = 0, encaisse = 0;
    payees.forEach(function (c) {
      (c.paiements || []).forEach(function (p) {
        var m = mode(p.mode);
        paiements[m] = paiements[m] || { nb: 0, montant: 0 };
        paiements[m].nb++; paiements[m].montant = r2(paiements[m].montant + (p.montant || 0)); encaisse += (p.montant || 0);
        if (estTR(m)) { nbTickets += (p.nb_tickets || 0); if (p.surplus > 0) { avNb++; avMt += p.surplus; encaisse += p.surplus; } }
      });
    });

    var tva = {};
    payees.forEach(function (c) {
      var arts = c.articles || [];
      var brut = arts.reduce(function (s, a) { return s + (a.prix || 0) * (a.qte || 1); }, 0);
      var coef = (c.remise && c.remise.montant && brut > 0) ? Math.max(0, c.total || 0) / brut : 1;
      if (!arts.length && c.total) { arts = [{ prix: c.total, qte: 1 }]; coef = 1; }   // commande sans détail : tout au taux sur place
      arts.forEach(function (a) {
        var prod = produits[a.prodId] || {};
        var taux = (prod.tva === 'a_emporter') ? (tvaP.a_emporter || 5.5) : (tvaP.sur_place || 10);
        var ttc = r2((a.prix || 0) * (a.qte || 1) * coef);
        var ht = r2(ttc / (1 + taux / 100));
        tva[taux] = tva[taux] || { ttc: 0, ht: 0, tva: 0 };
        tva[taux].ttc = r2(tva[taux].ttc + ttc); tva[taux].ht = r2(tva[taux].ht + ht); tva[taux].tva = r2(tva[taux].tva + (ttc - ht));
      });
    });
    var totalHT = r2(Object.keys(tva).reduce(function (s, t) { return s + tva[t].ht; }, 0));

    var remises = payees.filter(function (c) { return c.remise && c.remise.montant > 0; });
    var annul = Object.keys(annulJour || {}).map(function (k) { return annulJour[k]; }).filter(function (c) { return c && du(c); });
    var heures = payees.map(function (c) { return c.heure; }).filter(Boolean).sort();
    var comptages = Object.keys(fonds || {}).map(function (k) { return fonds[k]; }).filter(Boolean)
      .sort(function (a, b) { return String(a.heure || '').localeCompare(String(b.heure || '')); });
    var premiere = heures[0] || '99:99';
    var avant = comptages.filter(function (f) { return String(f.heure || '') <= premiere; });
    var fondInit = avant.length ? avant[avant.length - 1] : (comptages[0] || null);
    var especes = (paiements['Espèces'] || {}).montant || 0;

    return {
      service: service || 'jour', ouverture: heures[0] || '', fermeture: heures[heures.length - 1] || '',
      nb_commandes: nbCmd, nb_couverts: nbCvt, ca_total: ca,
      ticket_moyen: nbCmd ? r2(ca / nbCmd) : 0, panier_moyen: nbCvt ? r2(ca / nbCvt) : 0,
      paiements: trier(paiements), nb_tickets_resto: nbTickets, total_encaisse: r2(encaisse),
      avoirs_emis: { nb: avNb, montant: r2(avMt) },
      tva: tva, total_ht: totalHT, total_tva: r2(ca - totalHT),
      remises: { nb: remises.length, montant: r2(remises.reduce(function (s, c) { return s + c.remise.montant; }, 0)) },
      annulations: { nb: annul.length, montant: r2(annul.reduce(function (s, c) { return s + (c.total || 0); }, 0)) },
      non_soldees: nonSoldees.length,
      fond: { initial: fondInit ? fondInit.total : null, heure_initial: fondInit ? fondInit.heure : null,
              especes: especes, theorique: r2((fondInit ? fondInit.total : 0) + especes) }
    };
  }

  // Somme de plusieurs Z (consolidation par camion, par service, par période)
  function sommer(liste) {
    var out = { nb_commandes: 0, nb_couverts: 0, ca_total: 0, paiements: {}, nb_tickets_resto: 0, total_encaisse: 0,
                avoirs_emis: { nb: 0, montant: 0 }, tva: {}, total_ht: 0, total_tva: 0,
                remises: { nb: 0, montant: 0 }, annulations: { nb: 0, montant: 0 }, non_soldees: 0, nb_services: 0 };
    (liste || []).forEach(function (z) {
      if (!z) return;
      out.nb_services++;
      out.nb_commandes += z.nb_commandes || 0; out.nb_couverts += z.nb_couverts || 0; out.ca_total = r2(out.ca_total + (z.ca_total || 0));
      Object.keys(z.paiements || {}).forEach(function (m) {
        out.paiements[m] = out.paiements[m] || { nb: 0, montant: 0 };
        out.paiements[m].nb += z.paiements[m].nb || 0; out.paiements[m].montant = r2(out.paiements[m].montant + (z.paiements[m].montant || 0));
      });
      out.nb_tickets_resto += z.nb_tickets_resto || 0; out.total_encaisse = r2(out.total_encaisse + (z.total_encaisse || 0));
      out.avoirs_emis.nb += (z.avoirs_emis || {}).nb || 0; out.avoirs_emis.montant = r2(out.avoirs_emis.montant + ((z.avoirs_emis || {}).montant || 0));
      Object.keys(z.tva || {}).forEach(function (t) {
        out.tva[t] = out.tva[t] || { ttc: 0, ht: 0, tva: 0 };
        out.tva[t].ttc = r2(out.tva[t].ttc + z.tva[t].ttc); out.tva[t].ht = r2(out.tva[t].ht + z.tva[t].ht); out.tva[t].tva = r2(out.tva[t].tva + z.tva[t].tva);
      });
      out.total_ht = r2(out.total_ht + (z.total_ht || 0)); out.total_tva = r2(out.total_tva + (z.total_tva || 0));
      out.remises.nb += (z.remises || {}).nb || 0; out.remises.montant = r2(out.remises.montant + ((z.remises || {}).montant || 0));
      out.annulations.nb += (z.annulations || {}).nb || 0; out.annulations.montant = r2(out.annulations.montant + ((z.annulations || {}).montant || 0));
      out.non_soldees += z.non_soldees || 0;
    });
    out.paiements = trier(out.paiements);
    out.ticket_moyen = out.nb_commandes ? r2(out.ca_total / out.nb_commandes) : 0;
    out.panier_moyen = out.nb_couverts ? r2(out.ca_total / out.nb_couverts) : 0;
    return out;
  }

  // Applique des ajustements { champ: {valeur, origine, motif, par, le} } à un Z (copie) :
  //   champ = 'pmt:<mode>' | 'couverts' | 'remises' | 'annulations'
  // Un montant de paiement ajusté modifie le total encaissé et le CA TTC ; HT/TVA sont recalculés au prorata.
  function ajuster(z, ajustements) {
    if (!z) return z;
    var out = JSON.parse(JSON.stringify(z)); out.ajustements = {};
    var keys = Object.keys(ajustements || {});
    if (!keys.length) return out;
    keys.forEach(function (k) {
      var a = ajustements[k]; if (!a || a.valeur == null) return;
      var v = Number(a.valeur); if (isNaN(v)) return;
      if (k.indexOf('pmt:') === 0) {
        var m = k.slice(4);
        out.paiements[m] = out.paiements[m] || { nb: 0, montant: 0 };
        out.ajustements[k] = { origine: out.paiements[m].montant, valeur: r2(v), motif: a.motif || '', par: a.par || '', le: a.le || '' };
        out.paiements[m].montant = r2(v);
      } else if (k === 'couverts') { out.ajustements[k] = { origine: out.nb_couverts, valeur: Math.round(v), motif: a.motif || '', par: a.par || '', le: a.le || '' }; out.nb_couverts = Math.round(v); }
      else if (k === 'remises') { out.ajustements[k] = { origine: out.remises.montant, valeur: r2(v), motif: a.motif || '', par: a.par || '', le: a.le || '' }; out.remises.montant = r2(v); }
      else if (k === 'annulations') { out.ajustements[k] = { origine: out.annulations.montant, valeur: r2(v), motif: a.motif || '', par: a.par || '', le: a.le || '' }; out.annulations.montant = r2(v); }
    });
    var encaisse = r2(Object.keys(out.paiements).reduce(function (s, m) { return s + out.paiements[m].montant; }, 0) + ((out.avoirs_emis || {}).montant || 0));
    if (encaisse !== out.total_encaisse) {
      var caNew = r2(encaisse - ((out.avoirs_emis || {}).montant || 0));
      var ratio = out.ca_total > 0 ? caNew / out.ca_total : 0;
      Object.keys(out.tva).forEach(function (t) { var x = out.tva[t]; x.ttc = r2(x.ttc * ratio); x.ht = r2(x.ht * ratio); x.tva = r2(x.ttc - x.ht); });
      out.total_ht = r2(Object.keys(out.tva).reduce(function (s, t) { return s + out.tva[t].ht; }, 0));
      out.total_encaisse = encaisse; out.ca_total = caNew; out.total_tva = r2(caNew - out.total_ht);
      out.ticket_moyen = out.nb_commandes ? r2(caNew / out.nb_commandes) : 0;
    }
    out.panier_moyen = out.nb_couverts ? r2(out.ca_total / out.nb_couverts) : 0;
    return out;
  }

  var RapportZ = { VERSION: '1.0.0', MODES_ORDRE: ORDRE, mode: mode, serviceDe: serviceDe, calculer: calculer, sommer: sommer, ajuster: ajuster };
  if (typeof module !== 'undefined' && module.exports) module.exports = RapportZ;
  root.RapportZ = RapportZ;
})(typeof window !== 'undefined' ? window : globalThis);
