// CGExcel - Mots croises - worker de generation
'use strict';

let pret = false;
try {
  importScripts('./moteur.js');
  pret = true;
} catch (e) {
  self.postMessage({ type: 'erreur', message: 'moteur.js illisible : ' + e.message });
}

const M = self.MotsCroises || {};
let lexique = null;

async function chargerLexique() {
  if (lexique) return lexique;
  const rep = await fetch('./lexique.txt', { cache: 'force-cache' });
  if (!rep.ok) throw new Error('lexique.txt introuvable (HTTP ' + rep.status + ')');
  const txt = await rep.text();
  lexique = txt.split('\n').map(s => s.trim()).filter(Boolean);
  if (lexique.length < 100) throw new Error('lexique vide ou illisible');
  return lexique;
}

// cases appartenant a la fois a un mot impose horizontal et a un vertical
function compterCroisements(g, nl, nc, imposes) {
  const set = new Set(imposes), H = new Map(), V = new Map();
  const noter = (mot, cells, carte) => { if (set.has(mot)) cells.forEach(k => carte.set(k, mot)); };
  for (let r = 0; r < nl; r++) {
    let w = '', cs = [];
    for (let c = 0; c < nc; c++) {
      const v = g[r * nc + c];
      if (v < 0) { noter(w, cs, H); w = ''; cs = []; }
      else { w += String.fromCharCode(65 + v); cs.push(r * nc + c); }
    }
    noter(w, cs, H);
  }
  for (let c = 0; c < nc; c++) {
    let w = '', cs = [];
    for (let r = 0; r < nl; r++) {
      const v = g[r * nc + c];
      if (v < 0) { noter(w, cs, V); w = ''; cs = []; }
      else { w += String.fromCharCode(65 + v); cs.push(r * nc + c); }
    }
    noter(w, cs, V);
  }
  const out = [];
  for (const k of H.keys()) if (V.has(k)) out.push(H.get(k) + ' × ' + V.get(k));
  return out;
}

// combien de mots du theme figurent dans la grille
function compterThemes(g, nl, nc, theme) {
  if (!theme.length) return [];
  const set = new Set(theme), vus = new Set();
  const lire = (mot) => { if (set.has(mot)) vus.add(mot); };
  for (let r = 0; r < nl; r++) {
    let w = '';
    for (let c = 0; c < nc; c++) {
      const v = g[r * nc + c];
      if (v < 0) { lire(w); w = ''; } else w += String.fromCharCode(65 + v);
    }
    lire(w);
  }
  for (let c = 0; c < nc; c++) {
    let w = '';
    for (let r = 0; r < nl; r++) {
      const v = g[r * nc + c];
      if (v < 0) { lire(w); w = ''; } else w += String.fromCharCode(65 + v);
    }
    lire(w);
  }
  return [...vus];
}

let stop = false;
let cacheIndex = null, cleIndex = '';   // l'index est coûteux : on le garde
const pause = () => new Promise(r => setTimeout(r, 0));

self.onmessage = async (e) => {
  const p = e.data;
  if (p && p.mode === 'stop') { stop = true; return; }
  stop = false;

  // vérification d'une grille retouchée à la main
  if (p && p.mode === 'verifier') {
    try {
      const mots = await chargerLexique();
      // le lexique garde ses accents : on normalise comme le moteur
      const ens = new Set(mots.map(m => M.normaliser(m)));
      for (const m of (p.imposes || [])) {
        for (const x of String(m).split(/\s+/)) if (x) ens.add(M.normaliser(x));
      }
      const lire = (suite) => suite.length > 1 ? suite : null;
      const mauvais = [];
      const ajoute = (mot, ou) => { if (mot && !ens.has(mot)) mauvais.push(mot + ' (' + ou + ')'); };
      for (let r = 0; r < p.nl; r++) {
        let s = '';
        for (let c = 0; c < p.nc; c++) {
          const v = p.grille[r * p.nc + c];
          if (v < 0) { ajoute(lire(s), 'ligne ' + (r + 1)); s = ''; }
          else s += String.fromCharCode(65 + v);
        }
        ajoute(lire(s), 'ligne ' + (r + 1));
      }
      for (let c = 0; c < p.nc; c++) {
        let s = '';
        for (let r = 0; r < p.nl; r++) {
          const v = p.grille[r * p.nc + c];
          if (v < 0) { ajoute(lire(s), 'colonne ' + (c + 1)); s = ''; }
          else s += String.fromCharCode(65 + v);
        }
        ajoute(lire(s), 'colonne ' + (c + 1));
      }
      self.postMessage({ type: 'verif', mauvais });
    } catch (err) {
      self.postMessage({ type: 'erreur', message: String((err && err.message) || err) });
    }
    return;
  }
  try {
    if (!pret) throw new Error('moteur non charge');
    self.postMessage({ type: 'version', v: M.VERSION || '?' });
    self.postMessage({ type: 'info', texte: 'Chargement du lexique…' });
    const mots = await chargerLexique();

    const imposes = p.imposes || [];
    const theme = p.theme || [];
    const plats = imposes.join(' ').split(/\s+/).filter(Boolean);
    // mots imposes ET mots du theme sont proteges de la troncature du lexique
    // on ne reconstruit l'index que si les paramètres qui le déterminent changent
    const cle = [p.lmax || 12, p.niveau || 20000,
                 plats.slice().sort().join('|'), theme.slice().sort().join('|')].join('#');
    if (cle !== cleIndex) {
      self.postMessage({ type: 'info', texte: 'Indexation du lexique…' });
      cacheIndex = M.Index.depuisListe(mots, 2, p.lmax || 12,
                                       plats.concat(theme), p.niveau || 20000);
      cleIndex = cle;
    }
    const index = cacheIndex;

    // un mot impose absent du lexique ne pourra jamais etre place
    const absents = plats.filter(m => {
      const r = index.rang.get(m.length);
      return !r || !r.has(m);
    });
    if (absents.length) throw new Error('mots absents du lexique : ' + absents.join(', '));

    self.postMessage({ type: 'info', texte: 'Recherche…' });
    const masque = p.masque ? Uint8Array.from(p.masque) : null;
    const noirsImposes = p.noirsImposes ? Uint8Array.from(p.noirsImposes) : null;
    let injectes = [];      // mots du theme traites comme imposes facultatifs
    const faire = (densite, polissage, enrich) => new M.Generateur(index, p.nl, p.nc, {
      polissageMs: polissage || 0,
      themeMs: enrich || 0,
      motsImposes: imposes.concat(injectes),
      motsThemes: theme,
      masque, noirsImposes,
      densiteNoirs: densite,
      maxMots: p.maxMots || {},
      graine: p.graine ?? (Date.now() & 0x7fffffff),
      patience: 15, relache: 4
    });

    let G, r = null;

    // ---- exploration longue : on cherche sans limite de temps, en publiant
    //      chaque amélioration, jusqu'a ce que l'utilisateur arrête
    if (p.mode === 'explorer') {
      const dedans = masque ? masque.reduce((a, x) => a + (x ? 0 : 1), 0) : p.nl * p.nc;
      const nImp = noirsImposes ? noirsImposes.reduce((a, x) => a + (x ? 1 : 0), 0) : 0;
      const base = Math.max(p.densite, nImp / dedans);
      // le temps accorde a un essai tient compte des mots du theme injectes
      const court = Math.round(Math.max(2500, (p.duree || 8000) / 3
                    * (1 + dedans / 400 + imposes.length / 10)));
      const pas = Math.max(0.02, 1 / dedans);   // au moins une case noire

      // Le theme doit survivre a la recherche d'une meilleure densite : on
      // injecte ici aussi une poignee de mots du theme comme imposes, on
      // enrichit chaque grille trouvee, et l'on refuse toute grille qui ferait
      // reculer le theme sous ce que la grille actuelle atteint deja.
      const courts = theme.filter(m => m.length >= 3 && m.length <= 7);
      for (let i = courts.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [courts[i], courts[j]] = [courts[j], courts[i]];
      }
      let k = Math.min(courts.length, Math.max(4, Math.min(18, Math.round(dedans / 14))));
      let seuil = Math.max(0, Math.min(p.themeMin || 0, theme.length));
      const enrichMs = Math.max(2500, court / 2);

      let meilleurD = 2, meilleurT = -1, d = base, essais = 0;
      let echecs = 0, refusTheme = 0;
      while (!stop) {
        essais++;
        injectes = theme.length ? courts.slice(0, k) : [];
        self.postMessage({ type: 'info',
          texte: `Exploration : essai ${essais} à ${(100 * d).toFixed(0)} %`
                 + (injectes.length ? ` avec ${injectes.length} mots du thème` : '')
                 + (meilleurD < 2 ? ` — meilleure grille : ${(100 * meilleurD).toFixed(1)} %`
                    + (theme.length ? ` et ${meilleurT} mot(s) du thème` : '') : '') });
        const g = faire(d, 0, 0);
        const res = g.generer(1e9, 20000, court);
        await pause();
        if (res) {
          echecs = 0;
          let gr = res.grille;
          let nT = theme.length ? compterThemes(gr, p.nl, p.nc, theme).length : 0;
          // une passe d'enrichissement si le theme est en retrait
          if (theme.length && nT < Math.max(seuil, meilleurT)) {
            const outil = faire(d, 0, 0);
            gr = outil.enrichirTheme(gr, enrichMs);
            nT = compterThemes(gr, p.nl, p.nc, theme).length;
            await pause();
          }
          let noirs = 0;
          for (let i = 0; i < gr.length; i++)
            if (gr[i] === -2 && !(masque && masque[i])) noirs++;
          const dens = noirs / dedans;
          // on ne retient que ce qui progresse SANS sacrifier le theme :
          // moins de noires a theme tenu, ou plus de theme a noires egales
          const tientTheme = nT >= Math.max(seuil, 0);
          const mieux = (dens < meilleurD && tientTheme)
                     || (dens <= meilleurD && nT > meilleurT && meilleurD < 2);
          if (mieux) {
            meilleurD = Math.min(meilleurD, dens); meilleurT = nT; refusTheme = 0;
            self.postMessage({
              type: 'grille', provisoire: true,
              grille: Array.from(gr), poses: res.poses, densite: dens,
              croisements: compterCroisements(gr, p.nl, p.nc, plats),
              themesPlaces: compterThemes(gr, p.nl, p.nc, theme),
              version: M.VERSION || '?'
            });
            if (noirs === 0) {        // on ne fera pas mieux qu'une grille pleine
              self.postMessage({ type: 'fini',
                texte: `Grille sans aucune case noire trouvée après ${essais} essais : `
                       + `impossible de faire mieux.` });
              return;
            }
          } else if (dens < meilleurD && !tientTheme) {
            // la densite progressait mais le theme reculait : on patiente, puis
            // on abaisse d'un cran l'exigence plutot que de tourner sans fin
            if (++refusTheme >= 6 && seuil > 0) {
              seuil--; refusTheme = 0;
              self.postMessage({ type: 'info',
                texte: `Thème difficile à tenir : exigence ramenée à ${seuil} mot(s).` });
            }
          }
          d = Math.max(0, meilleurD - pas);
          if (Math.round(d * dedans) >= Math.round(meilleurD * dedans))
            d = Math.max(0, (Math.round(meilleurD * dedans) - 1) / dedans);
        } else {
          // rien trouve : on desserre la densite, et de temps en temps on
          // allege le nombre de mots du theme imposes d'office
          if (++echecs >= 3 && k > 2) { k = Math.max(2, Math.floor(k * 0.7)); echecs = 0; }
          d = meilleurD < 2 ? Math.min(meilleurD - pas / 2, 0.5)
                            : Math.min(d + pas, 0.5);
          if (meilleurD === 2 && d >= 0.499) d = base;
        }
        await pause();
      }
      self.postMessage({ type: 'fini',
        texte: meilleurD < 2
          ? `Exploration arrêtée après ${essais} essais — meilleure grille : `
            + `${(100 * meilleurD).toFixed(1)} %`
            + (theme.length ? ` avec ${meilleurT} mot(s) du thème.` : '.')
          : `Exploration arrêtée après ${essais} essais, sans solution.` });
      return;
    }

    if (p.affiner) {
      G = faire(p.densite, 0);
      r = G.optimiserDensite({ cycles: p.cycles || 4, dureePalier: p.palier || 2500,
                               dMax: Math.max(0.40, p.densite) });
    } else {
      // On part de la densite demandee et on va DANS LES DEUX SENS : si elle
      // convient, on descend tant qu'on trouve ; sinon on monte, par petits
      // pas tant qu'on est bas, puis plus vite. Le temps accorde a chaque
      // palier grandit avec la taille de la grille et le nombre de mots.
      const dedans = masque ? masque.reduce((a, x) => a + (x ? 0 : 1), 0) : p.nl * p.nc;
      const nImp = noirsImposes ? noirsImposes.reduce((a, x) => a + (x ? 1 : 0), 0) : 0;
      const base = Math.max(p.densite, nImp / dedans);
      const court = () => Math.round(Math.max(3000, (p.duree || 8000) / 3
                    * (1 + dedans / 400 + (imposes.length + injectes.length) / 8)));
      const t0 = Date.now(), budgetTotal = court() * 8;
      const reste = () => Date.now() - t0 < budgetTotal;

      const essai = async (d) => {
        if (stop) return null;
        await pause();
        self.postMessage({ type: 'info',
          texte: `Essai à ${(100 * d).toFixed(0)} % de cases noires`
                 + (injectes.length ? ` avec ${injectes.length} mots du thème imposés…` : '…') });
        const g = faire(d, 0, 0);
        G = g;
        return g.generer(1e9, 20000, court());
      };

      // Le thème rapporte peu en substitution après coup, alors que le
      // placement de mots imposés fonctionne bien : on injecte donc une
      // poignée de mots du thème COMME imposés, quitte à réduire leur nombre
      // tant que la grille ne boucle pas.
      let trouve = null, dTrouve = base;
      if (theme.length && !stop) {
        const courts = theme.filter(m => m.length >= 3 && m.length <= 7);
        for (let i = courts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [courts[i], courts[j]] = [courts[j], courts[i]];
        }
        let k = Math.min(courts.length, Math.max(4, Math.min(18, Math.round(dedans / 14))));
        while (k >= 2 && !trouve && !stop) {
          injectes = courts.slice(0, k);
          for (const dd of [base, base + 0.03, base + 0.06, base + 0.10]) {
            if (dd > 0.5) break;
            trouve = await essai(dd);
            if (trouve) { dTrouve = dd; break; }
          }
          if (!trouve) k = Math.floor(k * 0.7);
        }
        if (!trouve) injectes = [];
      }
      if (!trouve && !stop) { trouve = await essai(base); dTrouve = base; }
      if (trouve) {
        // on essaie ensuite de faire mieux en densite, sans perdre le theme
        const pasFin = Math.max(0.02, 1 / dedans);
        while (reste() && !stop && dTrouve > pasFin) {
          const d = Math.max(0, (Math.round(dTrouve * dedans) - 1) / dedans);
          const res = await essai(d);
          if (!res) break;
          trouve = res; dTrouve = d;
        }
      } else {
        let echec = base;
        for (let d = base; d <= 0.501 && reste() && !stop; ) {
          d += Math.max(d < 0.30 ? 0.02 : 0.05, 1 / dedans);
          const res = await essai(d);
          if (res) { trouve = res; dTrouve = d; break; }
          echec = d;
        }
        if (trouve && dTrouve - echec > 0.021) {   // resserrage
          let bas = echec, haut = dTrouve;
          for (let k = 0; k < 3 && reste() && haut - bas > 0.015; k++) {
            const m = (bas + haut) / 2;
            const res = essai(m);
            if (res) { trouve = res; dTrouve = m; haut = m; } else bas = m;
          }
        }
      }
      // Retouches appliquees DIRECTEMENT a la grille trouvee : relancer une
      // generation complete echouait souvent et l'on repartait alors avec la
      // grille brute, sans polissage ni enrichissement.
      if (trouve) {
        const outil = faire(dTrouve, 0, 0);
        let gr = trouve.grille;
        // Budgets propres, independants du temps deja consomme par la
        // recherche : sinon l'enrichissement n'avait que quelques secondes et
        // ne plaçait qu'un ou deux mots du theme.
        self.postMessage({ type: 'info', texte: 'Polissage des cases noires…' });
        gr = outil.polir(gr, null, Math.max(3000, (p.duree || 8000) / 2));
        self.postMessage({ type: 'info',
          texte: `${injectes.length} mot(s) du thème placés d'office, affinage…` });
        if (theme.length) {
          self.postMessage({ type: 'info', texte: 'Enrichissement du thème…' });
          gr = outil.enrichirTheme(gr, Math.max(12000, (p.duree || 8000) * 2.5));
          self.postMessage({ type: 'info',
            texte: `Thème : ${outil.diag.themeAjoutes || 0} substitution(s) réussie(s).` });
        }
        trouve = Object.assign({}, trouve, { grille: gr });
        G = outil;
      }
      r = trouve;
      if (r) self.postMessage({ type: 'info',
        texte: `Retenu : ${(100 * dTrouve).toFixed(0)} % de cases noires.` });
    }

    if (!r) { self.postMessage({ type: 'echec', diag: (G && G.diag) || {} }); return; }
    let noirs = 0;
    for (let i = 0; i < r.grille.length; i++)
      if (r.grille[i] === -2 && !(masque && masque[i])) noirs++;
    self.postMessage({
      type: 'grille',
      grille: Array.from(r.grille),
      poses: r.poses,
      densite: noirs / G.dedans.length,
      croisements: compterCroisements(r.grille, p.nl, p.nc, plats),
      themesPlaces: compterThemes(r.grille, p.nl, p.nc, theme),
      version: M.VERSION || '?'
    });
  } catch (err) {
    let msg = 'anomalie interne';
    if (err) msg = err.message || err.name || String(err);
    if (err && err.stack) msg += ' — ' + String(err.stack).split('\n')[1] || '';
    self.postMessage({ type: 'erreur', message: msg });
  }
};
