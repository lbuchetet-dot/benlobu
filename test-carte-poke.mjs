// Tests du module commun carte-poke.js sur un export réel de la base.
// Usage : node scripts/test-carte-poke.mjs [cartes.json] [parametres.json]
//   (fichiers exportés depuis la console Firebase : nœuds « cartes » et « parametres »)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CP = require(path.resolve(new URL('..', import.meta.url).pathname, 'carte-poke.js'));

const fCartes = process.argv[2] || 'cartes.json', fParams = process.argv[3] || 'parametres.json';
if (!fs.existsSync(fCartes) || !fs.existsSync(fParams)) { console.error('Fichiers export introuvables : ' + fCartes + ', ' + fParams); process.exit(2); }
const cartes = JSON.parse(fs.readFileSync(fCartes, 'utf8')), params = JSON.parse(fs.readFileSync(fParams, 'utf8'));
const produits = cartes.poke.produits, formules = CP.formulesActives(cartes.poke.formules), g = CP.grille(params, 'poke'), sc = CP.sauces(params, 'poke');

let ok = 0, ko = 0;
const eq = (label, a, b) => { const r = JSON.stringify(a) === JSON.stringify(b); (r ? ok++ : ko++); console.log((r ? '✔ ' : '✖ ') + label + (r ? '' : '  → obtenu ' + JSON.stringify(a) + ', attendu ' + JSON.stringify(b))); };

// Grille et tailles
eq('grille S/M/L', g.map(x => x.nom), ['S', 'M', 'L']);
eq('rang M', CP.rangTaille('M', g), 1);
eq('« L Saumon » déduit', CP.deduireAxes('L Saumon', g), { taille: 'L', proteine: 'Saumon' });

// Produit multi-protéines
const chira = Object.values(produits).find(p => /chiratch/i.test(p.nom));
eq('Chiratch : tailles', CP.axe(chira, 'taille', g), ['S', 'M', 'L']);
eq('Chiratch : 3 protéines', CP.axe(chira, 'proteine', g).length, 3);
eq('Chiratch : prix mini', CP.prixMin(chira, g), 11.9);
eq('Chiratch : M Saumon', CP.variante(chira, 'M', 'Saumon', g).prix, 15.9);

// Produit mono-protéine et produit à taille unique
const crousty = Object.values(produits).find(p => /crousty/i.test(p.nom));
eq('Crousty : pas de protéine', CP.axe(crousty, 'proteine', g), []);
eq('Crousty : L', CP.variante(crousty, 'L', '', g).prix, 17.9);
const cookie = Object.values(produits).find(p => /cookie/i.test(p.nom));
eq('Cookie : variante unique auto', CP.variante(cookie, null, null, g).prix, 4);

// Sauces
eq('4 sauces, +0,50', [sc.liste.length, sc.prixExtra], [4, 0.5]);
eq('2 sauces → +0,50', CP.prixSauces(2, sc.prixExtra), 0.5);
eq('libellé sauce sans doublon', CP.labelSauce('Sauce sucrée'), 'Sauce sucrée');
eq('libellé Spicy', CP.labelSauce('Spicy Mayo'), 'Sauce Spicy Mayo');

// Formules
eq('1 formule active', formules.length, 1);
const f = formules[0];
const chiraId = Object.keys(produits).find(id => produits[id] === chira);
eq('Chiratch éligible à la formule (catégorie entière)', CP.formulesPour(chiraId, formules, produits).length, 1);
eq('emplacements à choisir : Dessert + Boisson (sauce exclue)', CP.slotsMenu(f, produits).map(x => x.sl.label), ['Dessert', 'Boisson']);
eq('à la carte : dessert 4 + boisson 2', CP.prixSlotsALaCarte(f, produits, g), 6);

// Prix bowl seul et en menu : M Saumon, 2 sauces, supplément protéine 2,50
const v = CP.variante(chira, 'M', 'Saumon', g);
const sups = [{ nom: 'Proteine', prix: 2.5 }].concat(CP.saucesEnSupplements(['Sauce sucrée', 'Spicy Mayo'], sc.prixExtra));
const ctx = { prixVariante: v.prix, prixMinProduit: CP.prixMin(chira, g), supplements: sups, nbSauces: 0, prixExtraSauce: sc.prixExtra };
eq('seul = 15,90 + 2,50 + 0,50', CP.prixSeul(ctx), 18.9);
eq('menu = 16,90 + 4,00 + 2,50 + 0,50', CP.prixMenu(f, ctx), 23.9);
const slots = CP.slotsMenu(f, produits);
const compo = CP.composition(f, chira, chiraId, v, sups, { [slots[0].si]: 'mochi', [slots[1].si]: 'soda_33cl' }, produits, g);
eq('composition : 3 lignes', compo.map(c => c.label), ['Poké Bowl', 'Dessert', 'Boisson']);
eq('composition : bowl avec variante et sups', compo[0].nom, "Chiratch'eese M Saumon (Proteine, Sauce sucrée, Sauce Spicy Mayo)");

console.log(`\n${ok} OK, ${ko} KO`);
process.exit(ko ? 1 : 0);
