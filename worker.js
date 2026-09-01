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

self.onmessage = async (e) => {
  const p = e.data;
  try {
    if (!pret) throw new Error('moteur non charge');
    self.postMessage({ type: 'version', v: M.VERSION || '?' });
    self.postMessage({ type: 'info', texte: 'Chargement du lexique…' });
    const mots = await chargerLexique();

    self.postMessage({ type: 'info', texte: 'Indexation de ' + mots.length + ' mots…' });
    const imposes = p.imposes || [];
    const index = M.Index.depuisListe(mots, 2, p.lmax || 12, imposes, p.niveau || 20000);

    // un mot impose absent du lexique ne pourra jamais etre place
    const absents = imposes.filter(m => {
      const r = index.rang.get(m.length);
      return !r || !r.has(m);
    });
    if (absents.length) throw new Error('mots absents du lexique : ' + absents.join(', '));

    self.postMessage({ type: 'info', texte: 'Recherche…' });
    const masque = p.masque ? Uint8Array.from(p.masque) : null;
    const noirsImposes = p.noirsImposes ? Uint8Array.from(p.noirsImposes) : null;
    const faire = (densite, duree) => new M.Generateur(index, p.nl, p.nc, {
      motsImposes: imposes,
      motsThemes: p.theme || [],
      masque, noirsImposes,
      densiteNoirs: densite,
      maxMots: p.maxMots || {},
      graine: p.graine ?? (Date.now() & 0x7fffffff),
      patience: 15, relache: 4
    });

    let G, r = null;
    if (p.affiner) {
      G = faire(p.densite, 0);
      r = G.optimiserDensite({ cycles: p.cycles || 4, dureePalier: p.palier || 2500,
                               dMax: Math.max(0.40, p.densite) });
    } else {
      // La densite demandee est un MINIMUM. Montee rapide par paliers de 5
      // points pour trouver un niveau qui boucle, puis deux dichotomies pour
      // redescendre au plus juste. Sans cela, une montee de 2 en 2 depuis 0 %
      // demandait une trentaine d'essais avant de sortir quoi que ce soit.
      const dedans = masque ? masque.reduce((a, x) => a + (x ? 0 : 1), 0) : p.nl * p.nc;
      const nImp = noirsImposes ? noirsImposes.reduce((a, x) => a + (x ? 1 : 0), 0) : 0;
      const base = Math.max(p.densite, nImp / dedans);
      const court = Math.max(2000, (p.duree || 8000) / 4);
      const essai = (d) => {
        self.postMessage({ type: 'info',
          texte: `Essai avec ${(100 * d).toFixed(0)} % de cases noires…` });
        const g = faire(d, 0);
        const res = g.generer(1e9, 20000, court);
        if (res) G = g;
        return res;
      };
      let echec = null, trouve = null, dTrouve = base;
      for (let d = base; d <= 0.501; d += 0.05) {
        const res = essai(d);
        if (res) { trouve = res; dTrouve = d; break; }
        echec = d;
      }
      // on redescend ensuite le plus bas possible dans le temps imparti
      if (trouve) {
        const t0 = Date.now(), budget = (p.duree || 8000) * 2.5;
        if (echec !== null) {                         // dichotomie
          let bas = echec, haut = dTrouve;
          for (let k = 0; k < 5 && haut - bas > 0.008; k++) {
            if (Date.now() - t0 > budget) break;
            const m = (bas + haut) / 2;
            const res = essai(m);
            if (res) { trouve = res; dTrouve = m; haut = m; } else bas = m;
          }
        }
        while (Date.now() - t0 < budget && dTrouve - 0.02 >= base) {
          const res = essai(dTrouve - 0.02);          // grignotage
          if (!res) break;
          trouve = res; dTrouve -= 0.02;
        }
      }
      r = trouve;
      if (r && dTrouve > base + 0.005) self.postMessage({ type: 'info',
        texte: `Il a fallu monter à ${(100 * dTrouve).toFixed(0)} % de cases noires.` });
    }

    if (!r) { self.postMessage({ type: 'echec', diag: G.diag }); return; }
    let noirs = 0;
    for (let i = 0; i < r.grille.length; i++)
      if (r.grille[i] === -2 && !(masque && masque[i])) noirs++;
    self.postMessage({
      type: 'grille',
      grille: Array.from(r.grille),
      poses: r.poses,
      densite: noirs / G.dedans.length,
      croisements: compterCroisements(r.grille, p.nl, p.nc, imposes),
      version: M.VERSION || '?'
    });
  } catch (err) {
    let msg = 'anomalie interne';
    if (err) msg = err.message || err.name || String(err);
    if (err && err.stack) msg += ' — ' + String(err.stack).split('\n')[1] || '';
    self.postMessage({ type: 'erreur', message: msg });
  }
};
