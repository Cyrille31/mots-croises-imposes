# Consignes pour Claude — Mots croisés CGExcel

Application web (PWA) de mots croisés, en HTML/JS sans dépendance de
construction : `index.html` (interface), `moteur.js` (générateur),
`worker.js`, `sw.js` (service worker, hors ligne), `lexique.txt`.
Auteur : Cyrille Gindre — marque CGExcel. Publiée sur GitHub Pages.

## Numéros de version — à chaque modification

- **Interface** : incrémenter la révision (ex. 10.7 → 10.8) dès que l'on
  modifie l'application. Elle figure à deux endroits dans `index.html` :
  `<span id="vapp">` dans l'en-tête et la ligne « interface X.Y » du pied de page.
- **Moteur** : incrémenter `VERSION` dans `moteur.js` uniquement si
  `moteur.js` change.
- **Cache** : incrémenter `CACHE` dans `sw.js` (`mc-cgexcel-vNN`) dès qu'un
  fichier servi change, et ajouter à `FICHIERS` tout nouveau fichier nécessaire
  hors ligne.

## Licences

- Le logiciel est sous **licence MIT accompagnée de la BAL 1.0** (Bonne Action
  License : vœu de faire une bonne action par jour, sans valeur juridique et
  sans restreindre la MIT). Garder cette mention cohérente dans `LICENSE`,
  `README.md` et le pied de page de `index.html`.
- Copyright : « © 2026 Cyrille Gindre — marque CGExcel ».
- Toute ressource tierce ajoutée (bibliothèque, données…) doit être citée,
  avec son auteur et sa licence, dans la section « Ressources tierces » de
  `LICENSE` et dans la section « Licence » du `README.md`. Ne reprendre que des
  ressources à licence compatible (MIT, BSD, MPL, CC BY-SA pour les données…).
- Le pied de page mentionne le développement assisté par IA (Claude, Anthropic) ;
  le conserver.

## Style

- Tout en français : interface, commentaires, messages de commit, documentation.
- Code sobre, sans framework ni outil de construction ; commentaires courts qui
  expliquent l'intention.
- Toute nouveauté visible par l'utilisateur est décrite dans le « Mode
  d'emploi » (`<details id="notice">` dans `index.html`).
- L'application doit continuer à fonctionner hors ligne : embarquer les
  bibliothèques dans le dépôt plutôt que de les charger depuis un CDN.
