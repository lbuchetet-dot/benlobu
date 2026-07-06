# pokeben-web

Écosystème web **Pok&Ben / Capt&Fish** — front statique (React via CDN, sans build) sur base **Firebase** commune `pokeben-caisse` (europe-west1), déployé sur **Netlify**.

## Fichiers

| Fichier | Rôle | Domaine cible |
|---|---|---|
| `index.html` | Site public **Capt&Fish** (commande en ligne) | captainfish.fr |
| `pokeben-site.html` | Site public **Pok&Ben** | pokeben.fr |
| `admin.html` | Back-office (CRM fidélité, config sites, manuel & maintenance) | /admin.html |
| `caisse.html` | Caisse iPad (impression Epson + tiroir) | /caisse.html |
| `pokeben-fidelite.html` | App fidélité tablette (passages / points) | /pokeben-fidelite.html |
| `database.rules.json` | Règles de sécurité Realtime Database | — |

## Stack & config

- **Firebase** : projet `pokeben-caisse`, Realtime Database europe-west1, Auth anonyme (les règles exigent `auth != null`).
- **React** chargé via CDN, pas d'étape de build.
- **Netlify** : déploiement continu depuis la branche `main`.
- La clé `apiKey` Firebase présente dans les fichiers est une **clé cliente publique** (conçue pour être exposée côté navigateur) ; la sécurité repose sur `database.rules.json`.

## Sécurité (règles)

Lecture par défaut = **staff uniquement** (connexion non-anonyme). Les clients (sites publics) sont anonymes : lecture rouverte nœud par nœud uniquement sur les données publiques (aucune PII). Les commandes web sont créables/annulables en anonyme mais **non lisibles** en anonyme (PII protégée).

⚠️ **Ne jamais committer de secret serveur** (clé API Brevo, service account, etc.) — voir `.gitignore`.

## Déploiement

1. Sauvegarder la base Firebase (export JSON) avant tout changement de règles.
2. Commit de la version courante.
3. Tester sur préversion (Netlify deploy preview).
4. Vérifier : console propre, parcours critiques, test Safari/mobile, pas de 403/500, bandeau cookies OK.
5. Merge/push sur `main` → auto-deploy Netlify (~30 s).

## Config à faire une fois

- Chaque tablette fidélité : admin (PIN) → « Cette tablette » → camion.
- iPad caisse : bouton « Imprimante » → méthode Bluetooth → appairer Epson TM Print Assistant.
- Renseigner le numéro de téléphone de contact dans **admin → Paramètres → infos légales** (utilisé sur le site quand un créneau n'est plus commandable).
