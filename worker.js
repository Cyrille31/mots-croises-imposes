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
      r = G.optimiserDensite({ cycles: p.cycles || 4, dureePalier: p.palier || 2500 });
    } else if (noirsImposes) {
      // on tente d'abord SANS aucune case noire ajoutee, puis on en concede
      const dedans = masque ? masque.reduce((a, x) => a + (x ? 0 : 1), 0) : p.nl * p.nc;
      const nImp = noirsImposes.reduce((a, x) => a + (x ? 1 : 0), 0);
      const base = nImp / dedans, plafond = Math.max(base, p.densite);
      const duree = p.duree || 8000;
      for (let d = base; d <= plafond + 1e-9; d += 0.03) {
        self.postMessage({ type: 'info',
          texte: `Essai avec ${(100 * d).toFixed(0)} % de cases noires…` });
        G = faire(d, 0);
        r = G.generer(1e9, 20000, Math.max(2000, duree / 4));
        if (r) { if (d > base + 1e-9) self.postMessage({ type: 'info',
          texte: `Cases noires ajoutées pour boucler (${(100 * d).toFixed(0)} %).` }); break; }
      }
    } else {
      G = faire(p.densite, 0);
      r = G.generer(1e9, 20000, p.duree || 8000);
    }

    if (!r) { self.postMessage({ type: 'echec', diag: G.diag }); return; }
    const noirs = Array.from(r.grille).filter(x => x === -2).length;
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
