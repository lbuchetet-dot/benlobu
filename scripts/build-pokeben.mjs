// ══════════════════════════════════════════════════════════════════════════════
//  BUILD SEO POK&BEN — génère le dossier `pokeben/` publié par Netlify
//
//  À chaque déploiement (et chaque nuit via un build programmé) :
//   1. lit le planning, la carte et la config dans Firebase
//   2. injecte dans le HTML le planning et la carte EN TEXTE (lisibles sans JS)
//   3. génère une page par commune  →  /emplacements/<commune>/
//   4. écrit sitemap.xml, robots.txt, _redirects (table de migration WordPress)
//
//  Usage :  node scripts/build-pokeben.mjs
//  Env   :  FIREBASE_DB_URL     (ex. https://xxx-default-rtdb.europe-west1.firebasedatabase.app)
//           FIREBASE_DB_SECRET  (secret de base, Paramètres > Comptes de service > Secrets)
//           Sans ces variables : repli sur le planning par défaut embarqué dans le HTML.
// ══════════════════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT   = path.resolve(new URL('..', import.meta.url).pathname);
const SRC    = path.join(ROOT, 'pokeben-site.html');
const OUT    = path.join(ROOT, 'pokeben');
const ORIGIN = 'https://pokeben.fr';
const JOURS  = ['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];

const html = fs.readFileSync(SRC, 'utf8');

// ── 1. Données ──────────────────────────────────────────────────────────────
async function fb(pathKey){
  const url=process.env.FIREBASE_DB_URL, secret=process.env.FIREBASE_DB_SECRET;
  if(!url||!secret) return null;
  const r=await fetch(`${url.replace(/\/$/,'')}/${pathKey}.json?auth=${secret}`);
  if(!r.ok) throw new Error(`Firebase ${pathKey}: ${r.status}`);
  return r.json();
}
function planningParDefaut(){
  const m=html.match(/const PLANNING_DEFAULT=(\{[\s\S]*?\n\});/);
  if(!m) return {};
  return vm.runInNewContext('('+m[1]+')');
}
const planning = (await fb('spots_pokeben').catch(e=>{console.warn(e.message);return null;})) || planningParDefaut();
const produits = (await fb('cartes/poke/produits').catch(()=>null)) || {};
const tailles  = (await fb('parametres/grille_tailles/poke').catch(()=>null)) || [];
const sauces   = (await fb('parametres/sauces/poke').catch(()=>null)) || {liste:[]};

// ── 2. Helpers ───────────────────────────────────────────────────────────────
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const slug = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
  .replace(/—.*$/,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
// « Briffaut — Auto Bernard » → commune Valence ; « Valence 2 — Décathlon » → Valence
const COMMUNE_DE = lieu => {
  const l=String(lieu);
  if(/valence|briffaut|lautagne|leroy merlin/i.test(l) && !/portes/i.test(l)) return 'Valence';
  if(/portes/i.test(l)) return 'Portes-lès-Valence';
  return l.replace(/\s+—.*$/,'').trim();
};
const prixMin = p => { const v=Object.values(p.tailles||{}).map(t=>Number(t.prix)).filter(n=>!isNaN(n)); return v.length?Math.min(...v):null; };
const eur = n => n.toFixed(2).replace('.',',')+'\u202f€';

// Créneaux à plat
const creneaux=[];
for(const j of JOURS){
  const d=planning[j]; if(!d) continue;
  for(const cam of ['c1','c2']) (d[cam]||[]).forEach(s=>{ if(s&&s.lieu) creneaux.push({jour:j,cam,lieu:s.lieu,adresse:s.adresse||'',horaires:s.horaires||'',service:s.service||'',commune:COMMUNE_DE(s.lieu)}); });
}
const communes=[...new Set(creneaux.map(c=>c.commune))].sort((a,b)=>a.localeCompare(b,'fr'));

// ── 3. Blocs statiques ──────────────────────────────────────────────────────
function blocPlanning(){
  let h='<h2>Planning de la semaine — tous nos emplacements</h2><ul>';
  for(const j of JOURS){
    const cs=creneaux.filter(c=>c.jour===j); if(!cs.length) continue;
    for(const c of cs){
      h+=`<li><strong>${esc(j)} ${esc(c.service||'')}</strong> · ${c.cam==='c1'?'Camion 1':'Camion 2'} · <a href="/emplacements/${slug(c.commune)}/">${esc(c.lieu)}</a>${c.adresse?' — '+esc(c.adresse):''} · ${esc(c.horaires)}</li>`;
    }
  }
  h+='</ul><h2>Nos communes</h2><ul>'+communes.map(c=>`<li><a href="/emplacements/${slug(c)}/">Food truck poké bowl à ${esc(c)}</a></li>`).join('')+'</ul>';
  return h;
}
function blocCarte(){
  const actifs=Object.values(produits).filter(p=>p&&p.actif!==false&&p.nom&&!/suppl|sauce/i.test(p.categorie||''));
  if(!actifs.length) return '';
  const parCat={};
  for(const p of actifs){ (parCat[p.categorie||'Autres']=parCat[p.categorie||'Autres']||[]).push(p); }
  let h='';
  for(const [cat,list] of Object.entries(parCat)){
    h+=`<h2>${esc(cat)}</h2><ul>`+list.map(p=>{ const pm=prixMin(p); return `<li><strong>${esc(p.nom)}</strong>${p.description?' — '+esc(p.description):''}${pm!=null?' · <em>dès '+eur(pm)+'</em>':''}</li>`; }).join('')+'</ul>';
  }
  if(tailles.length) h+=`<p>Tailles : ${tailles.map(t=>esc(t.nom)+(t.supp>0?' (+'+eur(Number(t.supp))+')':'')).join(' · ')}.</p>`;
  if(sauces.liste&&sauces.liste.length) h+=`<p>Sauces au choix : ${sauces.liste.map(esc).join(', ')} — une incluse.</p>`;
  return h;
}
function ldCarte(){
  const actifs=Object.values(produits).filter(p=>p&&p.actif!==false&&p.nom&&!/suppl|sauce/i.test(p.categorie||''));
  return {"@context":"https://schema.org","@type":"Menu","name":"Carte Pok&Ben","hasMenuSection":Object.entries(actifs.reduce((a,p)=>{(a[p.categorie||'Autres']=a[p.categorie||'Autres']||[]).push(p);return a;},{})).map(([cat,list])=>({"@type":"MenuSection","name":cat,"hasMenuItem":list.map(p=>({"@type":"MenuItem","name":p.nom,"description":p.description||undefined,"offers":prixMin(p)!=null?{"@type":"Offer","price":prixMin(p).toFixed(2),"priceCurrency":"EUR"}:undefined}))}))};
}

// ── 4. Page principale ──────────────────────────────────────────────────────
let page = html
  .replace('<!--PLANNING_STATIQUE-->', blocPlanning())
  .replace('<!--CARTE_STATIQUE-->', blocCarte())
  .replace('</head>', `<script type="application/ld+json" id="ld-menu">${JSON.stringify(ldCarte())}</script>\n</head>`);
// le planning par défaut embarqué suit Firebase (le site n'affiche jamais un vieux planning)
if(Object.keys(planning).length) page = page.replace(/const PLANNING_DEFAULT=\{[\s\S]*?\n\};/, 'const PLANNING_DEFAULT='+JSON.stringify(planning)+';');

fs.rmSync(OUT,{recursive:true,force:true}); fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'index.html'), page);
// fichiers partagés
for(const f of ['pokeben-fid-192.png','pokeben-fid-512.png','pokeben-fid-maskable-512.png']) if(fs.existsSync(path.join(ROOT,f))) fs.copyFileSync(path.join(ROOT,f), path.join(OUT,f));

// ── 5. Pages communes ──────────────────────────────────────────────────────
const JOURS_ORD = j => JOURS.indexOf(j);
for(const commune of communes){
  const cs=creneaux.filter(c=>c.commune===commune).sort((a,b)=>JOURS_ORD(a.jour)-JOURS_ORD(b.jour));
  const title=`Food truck poké bowl à ${commune} — ${cs.map(c=>c.jour+' '+(c.service||'')).join(', ')} · Pok&Ben`;
  const desc=`Pok&Ben, le food truck poké bowl, est à ${commune} ${cs.map(c=>`${c.jour.toLowerCase()} ${(c.service||'').toLowerCase()} (${c.lieu}${c.adresse?', '+c.adresse:''}, ${c.horaires})`).join(' et ')}. Commande en ligne, retrait au camion.`;
  const url=`${ORIGIN}/emplacements/${slug(commune)}/`;
  const ld={"@context":"https://schema.org","@type":"FoodEstablishment","name":`Pok&Ben — food truck à ${commune}`,"parentOrganization":{"@id":`${ORIGIN}/#org`},"url":url,"telephone":"+33482329536","servesCuisine":"Poké bowl","address":{"@type":"PostalAddress","addressLocality":commune,"addressRegion":"Drôme","addressCountry":"FR"},"openingHoursSpecification":cs.map(c=>{const m=c.horaires.match(/(\d{1,2})h(\d{2})?\D+(\d{1,2})h(\d{2})?/);return {"@type":"OpeningHoursSpecification","dayOfWeek":({Lundi:'Monday',Mardi:'Tuesday',Mercredi:'Wednesday',Jeudi:'Thursday',Vendredi:'Friday',Samedi:'Saturday',Dimanche:'Sunday'})[c.jour],"opens":m?`${m[1].padStart(2,'0')}:${m[2]||'00'}`:undefined,"closes":m?`${m[3].padStart(2,'0')}:${m[4]||'00'}`:undefined,"description":c.lieu+(c.adresse?' — '+c.adresse:'')};})};
  const corps=`
<div class="planning-page"><div class="planning-inner" style="max-width:760px">
  <nav aria-label="Fil d'Ariane" style="font-size:.78rem;color:var(--ink3);margin-bottom:.8rem"><a href="/" style="color:inherit">Accueil</a> › <a href="/emplacements" style="color:inherit">Emplacements</a> › ${esc(commune)}</nav>
  <div class="pg-eyebrow">Où nous trouver</div>
  <h1 class="pg-h1">Food truck poké bowl à ${esc(commune)}</h1>
  <p class="pg-sub">Pok&amp;Ben s'installe à ${esc(commune)} chaque semaine. Poké bowls frais préparés à la commande, en trois tailles, avec choix de la protéine et de la sauce — et la formule avec dessert et boisson.</p>
  <h2 style="font-family:'Playfair Display',serif;font-size:1.25rem;margin:1.4rem 0 .5rem">Quand et où</h2>
  <ul id="pg-static">${cs.map(c=>`<li><strong>${esc(c.jour)} ${esc(c.service||'')}</strong> · ${c.cam==='c1'?'Camion 1':'Camion 2'} · ${esc(c.lieu)}${c.adresse?' — '+esc(c.adresse):''} · ${esc(c.horaires)}${c.adresse?` · <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(c.adresse+' '+commune)}" target="_blank" rel="noopener">Itinéraire</a>`:''}</li>`).join('')}</ul>
  <p class="pg-sub">Pour être sûr d'avoir votre bowl et ne pas attendre, <a href="/commander" style="color:var(--grn);font-weight:700">commandez en ligne</a> et retirez-le au camion. Commande par téléphone au <a href="tel:0482329536" style="color:var(--grn);font-weight:700">04 82 32 95 36</a> — précisez ${cs[0].cam==='c1'?'Camion 1':'Camion 2'}.</p>
  <h2 style="font-family:'Playfair Display',serif;font-size:1.25rem;margin:1.4rem 0 .5rem">Nos autres emplacements</h2>
  <ul>${communes.filter(c=>c!==commune).map(c=>`<li><a href="/emplacements/${slug(c)}/" style="color:var(--grn);font-weight:700">Food truck à ${esc(c)}</a></li>`).join('')}</ul>
  <p class="pg-sub" style="margin-top:1.2rem">Un événement à ${esc(commune)} ou dans les environs ? <a href="/evenements" style="color:var(--grn);font-weight:700">On privatise le camion</a> pour vos mariages, séminaires et anniversaires.</p>
</div></div>`;
  // Page = même coquille (nav, styles, pied) que le site, corps statique, sans l'app de commande
  let ph = page
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace('</head>', `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n<script type="application/ld+json">${JSON.stringify({"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Accueil","item":ORIGIN+'/'},{"@type":"ListItem","position":2,"name":"Emplacements","item":ORIGIN+'/emplacements'},{"@type":"ListItem","position":3,"name":commune,"item":url}]})}</script>\n</head>`);
  // remplace le contenu de la page d'accueil par le corps statique et force cette page active
  ph = ph.replace(/<div class="page active" id="page-home">[\s\S]*?(?=<div class="page" id="page-events">)/, `<div class="page active" id="page-home">${corps}</div>\n`);
  // le routeur ne doit pas rediriger (l'URL n'est pas une route connue) : il laisse la page telle quelle
  const dir=path.join(OUT,'emplacements',slug(commune)); fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'), ph);
}

// ── 6. sitemap, robots, redirections ─────────────────────────────────────────
const today=new Date().toISOString().slice(0,10);
const urls=[
  {u:'/',pr:'1.0',f:'daily'},{u:'/la-carte',pr:'0.9',f:'weekly'},{u:'/commander',pr:'0.8',f:'weekly'},
  {u:'/emplacements',pr:'0.9',f:'daily'},{u:'/evenements',pr:'0.9',f:'monthly'},{u:'/a-propos',pr:'0.5',f:'yearly'},{u:'/contact',pr:'0.5',f:'yearly'},
  ...communes.map(c=>({u:`/emplacements/${slug(c)}/`,pr:'0.8',f:'weekly'}))
];
fs.writeFileSync(path.join(OUT,'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(x=>`  <url><loc>${ORIGIN}${x.u}</loc><lastmod>${today}</lastmod><changefreq>${x.f}</changefreq><priority>${x.pr}</priority></url>`).join('\n')}\n</urlset>\n`);
fs.writeFileSync(path.join(OUT,'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /ma-commande\nSitemap: ${ORIGIN}/sitemap.xml\n`);

// Redirections : migration WordPress → nouveau site (301), puis routes de l'app (200)
const redirects = `
# ── Migration pokeben.fr (WordPress) → nouveau site : 301, jamais vers l'accueil par facilité
/la-carte/                              /la-carte              301
/product-category/nos_pokes/            /la-carte              301
/product-category/nos_pokes             /la-carte              301
/product-category/nos-desserts/         /la-carte#desserts     301
/product-category/nos-boissons/         /la-carte#boissons     301
/product-category/*                     /la-carte              301
/product/formule/                       /la-carte              301
/product/*                              /la-carte              301
/nos-emplacements/                      /emplacements          301
/nos-emplacements                       /emplacements          301
/evenements/                            /evenements            301
/livraison-repas-valence/               /evenements            301
/livraison-repas-valence                /evenements            301
/a-propos/                              /a-propos              301
/contact/                               /contact               301
/my-account/*                           /commander             301
/cart/                                  /commander             301
/checkout/*                             /commander             301
/wp/mentions-legal                      /                      301
/wp/politique_de_confidentialite        /                      301
/wp/plan_du_site                        /                      301
/feed/                                  /                      410
/wp-json/*                              /                      410
/wp-login.php                           /                      410
/xmlrpc.php                             /                      410
/app/uploads/*                          /                      301
/wp-content/*                           /                      301

# ── www → racine
https://www.pokeben.fr/*                https://pokeben.fr/:splat   301!

# ── Application monopage : chaque route sert index.html (le routeur JS lit l'URL)
/la-carte                               /index.html            200
/commander                              /index.html            200
/emplacements                           /index.html            200
/evenements                             /index.html            200
/a-propos                               /index.html            200
/contact                                /index.html            200
/ma-commande                            /index.html            200
`;
fs.writeFileSync(path.join(OUT,'_redirects'), redirects.trimStart());
fs.writeFileSync(path.join(OUT,'_headers'), `/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: public, max-age=0, must-revalidate\n/*.png\n  Cache-Control: public, max-age=31536000, immutable\n`);

console.log(`✔ pokeben/ généré — ${creneaux.length} créneaux, ${communes.length} pages communes : ${communes.join(', ')}`);
