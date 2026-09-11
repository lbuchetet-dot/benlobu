// ══════════════════════════════════════════════════════════════════════════════
//  REBUILD NOCTURNE POK&BEN — netlify/functions/rebuild-pokeben-nuit.mjs
//
//  Le planning des camions change chaque semaine dans l'admin. Les pages communes
//  (/emplacements/<commune>/) et le sitemap sont écrits EN DUR au moment du build :
//  sans reconstruction, Google finirait par lire de faux créneaux.
//  Cette fonction déclenche un build chaque nuit à 3h UTC (5h en été, 4h en hiver).
//
//  Le dépôt est partagé avec Capt&Fish : la fonction existe aussi sur ce projet,
//  mais n'y fait rien, car la variable POKEBEN_BUILD_HOOK n'est définie QUE sur
//  le projet Netlify Pok&Ben.
// ══════════════════════════════════════════════════════════════════════════════
export default async () => {
  const hook = process.env.POKEBEN_BUILD_HOOK;
  if (!hook) {
    console.log('POKEBEN_BUILD_HOOK absente : projet non concerné, aucun build déclenché.');
    return new Response('skip');
  }
  const url = hook + (hook.includes('?') ? '&' : '?') + 'trigger_title=' + encodeURIComponent('Rebuild nuit — planning du jour');
  const r = await fetch(url, { method: 'POST' });
  console.log(`Build hook Pok&Ben : HTTP ${r.status}`);
  return new Response(r.ok ? 'ok' : 'erreur', { status: r.ok ? 200 : 500 });
};

export const config = { schedule: '0 3 * * *' };
