// CGExcel - Mots croises - worker de generation
'use strict';
importScripts('./moteur.js');
const { Index, Generateur } = self.MotsCroises || self;

let index = null, lexique = null;

async function chargerLexique() {
  if (lexique) return lexique;
  const rep = await fetch('./lexique.txt.gz');
  const flux = rep.body.pipeThrough(new DecompressionStream('gzip'));
  const txt = await new Response(flux).text();
  lexique = txt.split('\n').filter(Boolean);   // deja tries par frequence
  return lexique;
}

self.onmessage = async (e) => {
  const p = e.data;
  try {
    const mots = await chargerLexique();
    const imposes = p.imposes || [];
    index = Index.depuisListe(mots, 2, p.lmax || 12, imposes, p.niveau || 20000);
    self.postMessage({ type: 'pret', nbMots: mots.length });

    const G = new Generateur(index, p.nl, p.nc, {
      motsImposes: imposes,
      motsThemes: p.theme || [],
      masque: p.masque ? Uint8Array.from(p.masque) : null,
      densiteNoirs: p.densite,
      maxMots: p.maxMots || {},
      graine: p.graine ?? (Date.now() & 0x7fffffff),
      patience: 15, relache: 4
    });

    let r;
    if (p.affiner) r = G.optimiserDensite({ cycles: p.cycles || 4, dureePalier: p.palier || 2000 });
    else r = G.generer(1e9, 20000, p.duree || 5000);

    if (!r) { self.postMessage({ type: 'echec' }); return; }
    const noirs = Array.from(r.grille).filter(x => x === -2).length;
    const dedans = G.dedans.length;
    self.postMessage({
      type: 'grille',
      grille: Array.from(r.grille),
      poses: r.poses,
      densite: noirs / dedans
    });
  } catch (err) {
    self.postMessage({ type: 'erreur', message: String(err && err.message || err) });
  }
};
