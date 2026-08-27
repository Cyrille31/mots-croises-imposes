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

self.onmessage = async (e) => {
  const p = e.data;
  try {
    if (!pret) throw new Error('moteur non charge');
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
    const G = new M.Generateur(index, p.nl, p.nc, {
      motsImposes: imposes,
      motsThemes: p.theme || [],
      masque: p.masque ? Uint8Array.from(p.masque) : null,
      densiteNoirs: p.densite,
      maxMots: p.maxMots || {},
      graine: p.graine ?? (Date.now() & 0x7fffffff),
      patience: 15, relache: 4
    });

    const r = p.affiner
      ? G.optimiserDensite({ cycles: p.cycles || 4, dureePalier: p.palier || 2500 })
      : G.generer(1e9, 20000, p.duree || 8000);

    if (!r) { self.postMessage({ type: 'echec', diag: G.diag }); return; }
    const noirs = Array.from(r.grille).filter(x => x === -2).length;
    self.postMessage({
      type: 'grille',
      grille: Array.from(r.grille),
      poses: r.poses,
      densite: noirs / G.dedans.length
    });
  } catch (err) {
    let msg = 'anomalie interne';
    if (err) msg = err.message || err.name || String(err);
    if (err && err.stack) msg += ' — ' + String(err.stack).split('\n')[1] || '';
    self.postMessage({ type: 'erreur', message: msg });
  }
};
