// CGExcel - Generateur de mots croises francais - moteur v4 (JS)
'use strict';

const VERSION = '1.9';
const NOIR = -2, VIDE = -1;

function normaliser(s) {
  return s.replace(/\u0153/g, 'oe').replace(/\u0152/g, 'OE')
    .replace(/\u00e6/g, 'ae').replace(/\u00c6/g, 'AE')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().trim();
}

class Index {
  // paires : [[mot, frequence], ...]   prioritaires : mots imposes
  constructor(paires, lmin = 2, lmax = 12, prioritaires = [], maxParLong = 20000) {
    const prio = new Set(prioritaires.map(normaliser));
    const vus = new Map();
    for (const [m0, f] of paires) {
      const m = normaliser(m0);
      if (!/^[A-Z]+$/.test(m) || m.length < lmin || m.length > lmax) continue;
      if (!vus.has(m) || vus.get(m) < f) vus.set(m, f);
    }
    for (const m of prio) if (m.length >= lmin && m.length <= lmax && !vus.has(m)) vus.set(m, 0);

    const parL = new Map();
    for (const [m, f] of vus) {
      if (!parL.has(m.length)) parL.set(m.length, []);
      parL.get(m.length).push([f, m]);
    }
    // groupes de lettres reellement attestes dans le lexique
    this.bi = new Int32Array(26 * 26);
    this.tri = new Int32Array(26 * 26 * 26);
    for (const m of vus.keys()) {
      for (let p = 0; p + 1 < m.length; p++) {
        const a = m.charCodeAt(p) - 65, b = m.charCodeAt(p + 1) - 65;
        this.bi[a * 26 + b]++;
        if (p + 2 < m.length) this.tri[(a * 26 + b) * 26 + (m.charCodeAt(p + 2) - 65)]++;
      }
    }

    this.mots = new Map();   // L -> [mots tries par frequence decroissante]
    this.rang = new Map();   // L -> Map(mot -> indice)
    this.n32 = new Map();    // L -> nombre de mots de 32 bits
    this.masq = new Map();   // L -> Uint32Array[(pos*26+lettre)*n32]
    for (const [L, lst] of parL) {
      lst.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : 1));
      let mots = lst.map(x => x[1]);
      if (mots.length > maxParLong) {
        const garde = new Set(mots.slice(0, maxParLong));
        for (const m of prio) if (m.length === L) garde.add(m);
        mots = mots.filter(m => garde.has(m));
      }
      const n = mots.length, n32 = (n + 31) >> 5;
      const rang = new Map();
      const masq = new Uint32Array(L * 26 * n32);
      for (let k = 0; k < n; k++) {
        const mot = mots[k], bloc = k >> 5, bit = 1 << (k & 31);
        rang.set(mot, k);
        for (let p = 0; p < L; p++) {
          masq[((p * 26 + (mot.charCodeAt(p) - 65)) * n32) + bloc] |= bit;
        }
      }
      this.mots.set(L, mots); this.rang.set(L, rang);
      this.n32.set(L, n32); this.masq.set(L, masq);
    }
  }
  nb(L) { const m = this.mots.get(L); return m ? m.length : 0; }

  // Lexique livre sous forme d'une liste ordonnee du plus frequent au plus rare
  static depuisListe(mots, lmin = 2, lmax = 12, prioritaires = [], maxParLong = 20000) {
    const n = mots.length;
    return new Index(mots.map((m, i) => [m, n - i]), lmin, lmax, prioritaires, maxParLong);
  }
}

function maxRepet(L) { return L <= 2 ? 3 : (L === 3 ? 2 : 1); }

class Generateur {
  constructor(index, nl, nc, opts = {}) {
    this.ix = index; this.nl = nl; this.nc = nc;
    this.pNoir = opts.densiteNoirs ?? 0.28;
    this.lmax = Math.max(...index.mots.keys());
    this.exigerTous = opts.exigerTous ?? true;
    this.maxVoisinsNoirs = opts.maxVoisinsNoirs ?? 2;
    this.patience = opts.patience ?? 8;
    this.relache = opts.relache ?? 4;
    this.seuilGroupe = opts.seuilGroupe ?? 30;
    this.primeCroix = opts.primeCroix ?? 6;
    this.croixMin = opts.croisementsMin ?? 5;
    this.noirsImposes = opts.noirsImposes || null;   // 1 = case noire voulue
    this.nbNoirsImposes = this.noirsImposes
      ? this.noirsImposes.reduce((a, x) => a + (x ? 1 : 0), 0) : 0;
    this.diag = { squelette: 0, motif: 0, plafondCourt: 0, vuCourt: 0, resolution: 0 };
    this.masque = opts.masque || null;        // 1 = case hors silhouette
    this.angles = opts.anglesBlancs ?? true;  // pas de noir dans les angles
    this.maxMots = opts.maxMots || {};        // ex. {2: 4, 3: 10}
    this.dedans = [];
    for (let i = 0; i < nl * nc; i++) if (!this.masque || !this.masque[i]) this.dedans.push(i);
    this.theme = new Set((opts.motsThemes || []).map(normaliser));
    this.imposes = (opts.motsImposes || []).map(normaliser)
      .filter(m => index.rang.has(m.length) && index.rang.get(m.length).has(m));
    let s = opts.graine ?? 12345;
    this.rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  // ---------- motif de cases noires ----------
  segments(g) {
    const { nl, nc } = this, out = [];
    for (let r = 0; r < nl; r++) {
      let seg = [];
      for (let c = 0; c < nc; c++) {
        if (g[r * nc + c] === NOIR) { if (seg.length) out.push(seg); seg = []; }
        else seg.push(r * nc + c);
      }
      if (seg.length) out.push(seg);
    }
    for (let c = 0; c < nc; c++) {
      let seg = [];
      for (let r = 0; r < nl; r++) {
        if (g[r * nc + c] === NOIR) { if (seg.length) out.push(seg); seg = []; }
        else seg.push(r * nc + c);
      }
      if (seg.length) out.push(seg);
    }
    return out;
  }

  longRun(g, r, c, horiz) {
    const { nl, nc } = this;
    if (r < 0 || r >= nl || c < 0 || c >= nc || g[r * nc + c] === NOIR) return 0;
    let n = 1;
    if (horiz) {
      for (let j = c - 1; j >= 0 && g[r * nc + j] !== NOIR; j--) n++;
      for (let j = c + 1; j < nc && g[r * nc + j] !== NOIR; j++) n++;
    } else {
      for (let i = r - 1; i >= 0 && g[i * nc + c] !== NOIR; i--) n++;
      for (let i = r + 1; i < nl && g[i * nc + c] !== NOIR; i++) n++;
    }
    return n;
  }

  // interdit les paquets de noirs : aucun carre 2x2 entierement noir,
  // et au plus maxVoisinsNoirs noirs orthogonaux autour d'une case noire
  okNoir(g, r, c) {
    const { nl, nc } = this;
    const noir = (a, b) => (a < 0 || a >= nl || b < 0 || b >= nc)
      ? false : g[a * nc + b] === NOIR;
    for (const [dr, dc] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
      const a = r + dr, b = c + dc;
      if (noir(a, b) && noir(a + 1, b) && noir(a, b + 1) && noir(a + 1, b + 1)) return false;
    }
    let k = 0;
    for (const [a, b] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) if (noir(a, b)) k++;
    return k <= this.maxVoisinsNoirs;
  }

  okLocal(g, r, c) {
    if (!this.okNoir(g, r, c)) return false;
    const v = [[r, c - 1], [r, c + 1], [r - 1, c], [r + 1, c]];
    for (const [a, b] of v) {
      const h = this.longRun(g, a, b, true), w = this.longRun(g, a, b, false);
      if (h === 1 && w === 1) return false;   // case blanche orpheline
    }
    return true;
  }

  // Reserve la GEOMETRIE des emplacements des mots imposes (bornes noires,
  // interieur blanc) sans figer aucune lettre.
  placerUn(fixe, m) {
    const { nl, nc } = this;
    {
      const L = m.length;
      let best = null, bsc = -1e9;
      for (let essai = 0; essai < 300; essai++) {
        const h = this.rnd() < 0.5;
        if ((h && L > nc) || (!h && L > nl)) continue;
        const r = Math.floor(this.rnd() * (h ? nl : nl - L + 1));
        const c = Math.floor(this.rnd() * (h ? nc - L + 1 : nc));
        const cells = [], bords = [];
        for (let i = 0; i < L; i++) cells.push(h ? r * nc + c + i : (r + i) * nc + c);
        if (h) { if (c > 0) bords.push(r * nc + c - 1); if (c + L < nc) bords.push(r * nc + c + L); }
        else { if (r > 0) bords.push((r - 1) * nc + c); if (r + L < nl) bords.push((r + L) * nc + c); }
        if (cells.some(i => fixe[i] === 1) || bords.some(i => fixe[i] === 2)) continue;
        // pas de recouvrement colineaire avec un emplacement deja reserve
        let colin = false;
        for (const i of cells) {
          const rr = (i / nc) | 0, cc = i % nc;
          const av = h ? (cc > 0 ? i - 1 : -1) : (rr > 0 ? i - nc : -1);
          if (av >= 0 && fixe[av] === 2 && !cells.includes(av)) colin = true;
        }
        if (colin) continue;
        let croix = 0, para = 0;
        for (const i of cells) {
          if (fixe[i] === 2) croix++;
          const rr = (i / nc) | 0, cc = i % nc;
          const vs = h ? [[rr - 1, cc], [rr + 1, cc]] : [[rr, cc - 1], [rr, cc + 1]];
          for (const [a, b] of vs) {
            if (a >= 0 && a < nl && b >= 0 && b < nc && fixe[a * nc + b] === 2) para++;
          }
        }
        const sc = 6 * croix - 5 * para + this.rnd() * 4;
        if (sc > bsc) { bsc = sc; best = { cells, bords }; }
      }
      if (!best) return null;
      for (const i of best.cells) fixe[i] = 2;
      for (const i of best.bords) fixe[i] = 1;
      return { mot: m, cells: best.cells, bords: best.bords };
    }
  }

  // Squelette : entrelacement des seuls mots imposes, par retour arriere
  // randomise. Enumerer ces squelettes est tres bon marche.
  placementsPossibles(mot) {
    const { nl, nc } = this, L = mot.length, out = [];
    for (const h of [true, false]) {
      if ((h && L > nc) || (!h && L > nl)) continue;
      const maxR = h ? nl : nl - L + 1, maxC = h ? nc - L + 1 : nc;
      for (let r = 0; r < maxR; r++) for (let c = 0; c < maxC; c++) {
        const cells = [], bords = [];
        for (let i = 0; i < L; i++) cells.push(h ? r * nc + c + i : (r + i) * nc + c);
        if (h) { if (c > 0) bords.push(r * nc + c - 1); if (c + L < nc) bords.push(r * nc + c + L); }
        else { if (r > 0) bords.push((r - 1) * nc + c); if (r + L < nl) bords.push((r + L) * nc + c); }
        const cen = 1 - (Math.abs(r - nl / 2) + Math.abs(c - nc / 2)) / (nl + nc);
        out.push({ cells, bords, h, cen });
      }
    }
    return out;
  }

  // On vise croixMin croisements, mais on redescend le seuil si aucun
  // squelette n'existe a ce niveau : avec un ou deux mots imposes,
  // il ne peut pas y en avoir cinq.
  squelette(budget = 200000) {
    const plafond = Math.min(this.croixMin, Math.max(0, this.imposes.length - 1) * 2);
    for (let seuil = plafond; seuil >= 0; seuil--) {
      const s = this.squeletteAuSeuil(budget, seuil);
      if (s) return s;
    }
    return null;
  }

  squeletteAuSeuil(budget, seuil) {
    const { nl, nc } = this, N = nl * nc;
    const mots = [...this.imposes].sort((a, b) => b.length - a.length);
    if (!this._pl) this._pl = mots.map(m => this.placementsPossibles(m));
    const lettres = new Int8Array(N).fill(VIDE);
    const fixe = new Uint8Array(N);
    const idMot = new Int8Array(N).fill(-1);   // quel mot impose occupe la case
    if (this.noirsImposes) for (let i = 0; i < N; i++) if (this.noirsImposes[i]) fixe[i] = 1;
    let reste = budget, croixTotal = 0;
    const rec = (i) => {
      if (--reste <= 0) return false;
      if (i === mots.length) return croixTotal >= seuil;
      const mot = mots[i], L = mot.length;
      const cands = [];
      for (const p of this._pl[i]) {
        let croix = 0, ok = true;
        for (let j = 0; j < L; j++) {
          const idx = p.cells[j], v = lettres[idx];
          if (fixe[idx] === 1 || (this.masque && this.masque[idx])) { ok = false; break; }
          if (v === VIDE) continue;
          if (v !== mot.charCodeAt(j) - 65) { ok = false; break; }
          croix++;
        }
        if (!ok) continue;
        // identifiants des mots que ce placement croise : leurs cases ne
        // doivent pas etre comptees comme un encombrement du voisinage
        const croises = new Set();
        for (let j = 0; j < L; j++)
          if (lettres[p.cells[j]] !== VIDE) croises.add(idMot[p.cells[j]]);
        if (p.bords.some(x => lettres[x] !== VIDE)) continue;
        // mots colles autorises, a condition que les groupes de lettres
        // perpendiculaires soient attestes et courants en francais
        let para = 0, groupesOk = true;
        for (let j = 0; j < L && groupesOk; j++) {
          const idx = p.cells[j];
          // case deja occupee = croisement : le mot perpendiculaire est
          // deja un mot valide, il n'y a rien a verifier ici
          if (lettres[idx] !== VIDE) continue;
          const rr = (idx / nc) | 0, cc = idx % nc;
          // suite perpendiculaire contigue passant par cette case
          const suite = [];
          const pas = p.h ? nc : 1;
          const dansGrille = (k) => p.h ? (k >= 0 && k < nl * nc)
                                        : (((k / nc) | 0) === rr && k >= 0 && k < nl * nc);
          let k = idx - pas;
          while (dansGrille(k) && lettres[k] !== VIDE) { suite.unshift(lettres[k]); k -= pas; }
          suite.push(mot.charCodeAt(j) - 65);
          k = idx + pas;
          while (dansGrille(k) && lettres[k] !== VIDE) { suite.push(lettres[k]); k += pas; }
          if (suite.length < 2) continue;
          para += suite.length - 1;
          for (let q = 0; q + 1 < suite.length; q++) {
            if (this.ix.bi[suite[q] * 26 + suite[q + 1]] < this.seuilGroupe) { groupesOk = false; break; }
            if (q + 2 < suite.length &&
                this.ix.tri[(suite[q] * 26 + suite[q + 1]) * 26 + suite[q + 2]] < this.seuilGroupe) {
              groupesOk = false; break;
            }
          }
          if (suite.length > 4) groupesOk = false;   // pas plus de 4 mots colles
        }
        if (!groupesOk) continue;
        // on les eparpille plutot que de les entrelacer
        let proche = 0;
        for (const idx of p.cells) {
          const rr = (idx / nc) | 0, cc = idx % nc;
          for (let a = rr - 2; a <= rr + 2; a++) for (let b = cc - 2; b <= cc + 2; b++)
            if (a >= 0 && a < nl && b >= 0 && b < nc && lettres[a * nc + b] !== VIDE
                && !croises.has(idMot[a * nc + b])) proche++;
        }
        cands.push([this.primeCroix * croix - proche - 1.5 * para
                    + 2 * p.cen + this.rnd() * 10, p]);
      }
      cands.sort((a, b) => b[0] - a[0]);
      for (const [, p] of cands) {
        const sv = [], sb = [];
        let nCroix = 0;
        for (let j = 0; j < L; j++) {
          const idx = p.cells[j];
          if (lettres[idx] === VIDE) {
            lettres[idx] = mot.charCodeAt(j) - 65; fixe[idx] = 2; idMot[idx] = i; sv.push(idx);
          } else nCroix++;
        }
        croixTotal += nCroix;
        for (const x of p.bords) if (!fixe[x]) { fixe[x] = 1; sb.push(x); }
        if (rec(i + 1)) return true;
        croixTotal -= nCroix;
        for (const x of sv) { lettres[x] = VIDE; fixe[x] = 0; idMot[x] = -1; }
        for (const x of sb) fixe[x] = 0;
      }
      return false;
    };
    return rec(0) ? { fixe, lettres, liste: [] } : null;
  }

  reserver() {
    const fixe = new Uint8Array(this.nl * this.nc), liste = [];
    for (const m of [...this.imposes].sort((a, b) => b.length - a.length)) {
      const p = this.placerUn(fixe, m);
      if (!p) return null;
      liste.push(p);
    }
    return { fixe, liste };
  }

  rebatir(liste) {
    const fixe = new Uint8Array(this.nl * this.nc);
    for (const p of liste) {
      for (const i of p.cells) fixe[i] = 2;
      for (const i of p.bords) fixe[i] = 1;
    }
    return fixe;
  }

  motif(fixe) {
    const { nl, nc } = this, N = nl * nc, M = this.masque;
    if (!fixe) fixe = new Uint8Array(N);
    const g = new Int8Array(N).fill(VIDE);
    if (this.noirsImposes) for (let i = 0; i < N; i++) if (this.noirsImposes[i]) fixe[i] = 1;
    for (let i = 0; i < N; i++) if (fixe[i] === 1 || (M && M[i])) g[i] = NOIR;
    // une case dont la ligne OU la colonne est reduite a elle seule ne peut
    // porter aucune lettre : on la noircit d'office (frequent avec une silhouette)
    for (let passe = 0; passe < 40; passe++) {
      let change = false;
      for (const i of this.dedans) {
        if (g[i] === NOIR) continue;
        const r = (i / nc) | 0, c = i % nc;
        if (this.longRun(g, r, c, true) === 1 || this.longRun(g, r, c, false) === 1) {
          if (fixe[i] === 2) return null;      // lettre imposee isolee : impossible
          g[i] = NOIR; change = true;
        }
      }
      if (!change) break;
    }
    const cible = Math.round(this.pNoir * this.dedans.length);
    let poses = 0;
    for (const i of this.dedans) if (g[i] === NOIR) poses++;
    const ordre = [];
    for (const i of this.dedans) if (!fixe[i]) ordre.push(i);
    for (let i = ordre.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));[ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    }
    for (const mini of [2, 1]) {          // 1re passe : eviter les mots de 2 lettres
      for (const idx of ordre) {
        if (poses >= cible) break;
        if (g[idx] === NOIR) continue;
        const r = (idx / nc) | 0, c = idx % nc;
        g[idx] = NOIR;
        if (this.okLocal(g, r, c, mini)) poses++; else g[idx] = VIDE;
      }
      if (poses >= cible) break;
    }
    for (let passe = 0; passe < 80; passe++) {
      const longs = this.segments(g).filter(s => s.length > this.lmax);
      if (!longs.length) break;
      let progres = false;
      for (const seg of longs) {
        const mil = seg.slice(1, -1).filter(i => !fixe[i]);
        for (let i = mil.length - 1; i > 0; i--) {
          const j = Math.floor(this.rnd() * (i + 1));[mil[i], mil[j]] = [mil[j], mil[i]];
        }
        for (const idx of mil) {
          g[idx] = NOIR;
          if (this.okLocal(g, (idx / nc) | 0, idx % nc)) { progres = true; break; }
          g[idx] = VIDE;
        }
      }
      if (!progres) return null;
    }
    for (let i = 0; i < N; i++) {
      if (g[i] === NOIR) continue;
      const r = (i / nc) | 0, c = i % nc;
      if (this.longRun(g, r, c, true) === 1 && this.longRun(g, r, c, false) === 1) return null;
    }
    const cpt = new Map();
    for (const s of this.segments(g)) {
      if (s.length > this.lmax) return null;
      if (s.length >= 2) cpt.set(s.length, (cpt.get(s.length) || 0) + 1);
    }
    for (const [L, k] of cpt) if (k > this.ix.nb(L) * maxRepet(L)) return null;
    for (const L in this.maxMots) if ((cpt.get(+L) || 0) > this.maxMots[L]) {
      this.diag.plafondCourt++;
      this.diag.vuCourt = Math.max(this.diag.vuCourt, cpt.get(+L) || 0);
      return null;
    }
    const bes = new Map();
    for (const m of this.imposes) bes.set(m.length, (bes.get(m.length) || 0) + 1);
    for (const [L, k] of bes) if ((cpt.get(L) || 0) < k) return null;
    return g;
  }

  valide(g) {
    const { nl, nc } = this;
    for (let i = 0; i < g.length; i++) {
      if (g[i] === NOIR) continue;
      const r = (i / nc) | 0, c = i % nc;
      if (this.longRun(g, r, c, true) === 1 && this.longRun(g, r, c, false) === 1) return false;
    }
    const cpt = new Map();
    for (const s of this.segments(g)) {
      if (s.length > this.lmax) return false;
      if (s.length >= 2) cpt.set(s.length, (cpt.get(s.length) || 0) + 1);
    }
    for (const [L, k] of cpt) if (k > this.ix.nb(L) * maxRepet(L)) return false;
    for (const L in this.maxMots) if ((cpt.get(+L) || 0) > this.maxMots[L]) return false;
    const bes = new Map();
    for (const m of this.imposes) bes.set(m.length, (bes.get(m.length) || 0) + 1);
    for (const [L, k] of bes) if ((cpt.get(L) || 0) < k) return false;
    for (let i = 0; i < g.length; i++) {
      if (g[i] === NOIR && !this.okNoir(g, (i / this.nc) | 0, i % this.nc)) return false;
    }
    return true;
  }

  // Petit deplacement de cases noires autour de l'emplacement le plus fautif.
  muter(g, fixe, segs, conflits) {
    const { nl, nc } = this;
    let tot = 0;
    for (const c of conflits) tot += c;
    let cible;
    if (tot === 0) cible = Math.floor(this.rnd() * segs.length);
    else {
      let x = this.rnd() * tot, k = 0;
      while (k < conflits.length - 1 && (x -= conflits[k]) > 0) k++;
      cible = k;
    }
    const seg = segs[cible];
    const horiz = seg.length > 1 && (seg[1] - seg[0]) === 1;
    const pas = horiz ? 1 : nc;
    const avant = seg[0] - pas, apres = seg[seg.length - 1] + pas;
    const bornes = [];
    if (horiz ? (seg[0] % nc) > 0 : seg[0] >= nc) bornes.push(avant);
    if (horiz ? (seg[seg.length - 1] % nc) < nc - 1
              : seg[seg.length - 1] < nl * nc - nc) bornes.push(apres);

    for (let essai = 0; essai < 40; essai++) {
      const svg = Int8Array.from(g);
      const t = this.rnd();
      if (t < 0.4) {
        // couper l'emplacement en deux
        const mil = seg.slice(2, -2).filter(i => !fixe[i]);
        if (!mil.length) continue;
        g[mil[Math.floor(this.rnd() * mil.length)]] = NOIR;
      } else if (t < 0.75) {
        // allonger : retirer une borne noire
        const b = bornes.filter(i => !fixe[i] && g[i] === NOIR);
        if (!b.length) continue;
        g[b[Math.floor(this.rnd() * b.length)]] = VIDE;
      } else {
        // decaler une borne d'une case
        const b = bornes.filter(i => !fixe[i] && g[i] === NOIR);
        if (!b.length) continue;
        const src = b[Math.floor(this.rnd() * b.length)];
        const dst = src === avant ? src - pas : src + pas;
        if (dst < 0 || dst >= nl * nc || fixe[dst] || g[dst] === NOIR) continue;
        if (horiz && ((dst / nc) | 0) !== ((src / nc) | 0)) continue;
        g[src] = VIDE; g[dst] = NOIR;
      }
      if (this.valide(g)) return true;
      g.set(svg);
    }
    return false;
  }

  // ---------- resolution ----------
  resoudre(g, budget, init) {
    const ix = this.ix, nc = this.nc;
    const segs = this.segments(g).filter(s => s.length >= 2);
    // une case dont les deux sens sont de longueur 1 serait orpheline : deja exclu
    for (const s of segs) if (!ix.mots.has(s.length)) return null;
    const N = this.nl * this.nc;
    const grille = new Int8Array(N);
    for (let i = 0; i < N; i++)
      grille[i] = g[i] === NOIR ? NOIR : (init && init[i] >= 0 ? init[i] : VIDE);
    const nS = segs.length;
    // on efface les emplacements dont le contenu herite n'est plus un mot valide
    const emploiInit = new Map();
    for (const s of segs) {
      if (s.some(i => grille[i] < 0)) continue;
      const mot = s.map(i => String.fromCharCode(65 + grille[i])).join('');
      const rg = ix.rang.get(s.length);
      const n = (emploiInit.get(mot) || 0) + 1;
      if (!rg || !rg.has(mot) || n > maxRepet(s.length)) {
        for (const i of s) grille[i] = VIDE;
      } else emploiInit.set(mot, n);
    }

    const dom = [], tmp = [];
    for (const s of segs) dom.push(new Uint32Array(ix.n32.get(s.length)));
    const emploi = new Map();
    const restant = new Set(this.imposes);
    let poses = 0;
    const fait = new Uint8Array(nS);
    for (let i = 0; i < nS; i++) {
      const s = segs[i];
      if (s.some(k => grille[k] < 0)) continue;
      fait[i] = 1;
      const mot = s.map(k => String.fromCharCode(65 + grille[k])).join('');
      emploi.set(mot, (emploi.get(mot) || 0) + 1);
      if (restant.delete(mot)) poses++;
    }
    let meilleurN = -1, meilleurG = null, faits = 0;
    for (let i = 0; i < nS; i++) if (fait[i]) faits++;

    const calc = (i, out) => {
      const s = segs[i], L = s.length, n32 = ix.n32.get(L), mq = ix.masq.get(L);
      out.fill(0xffffffff, 0, n32);
      const n = ix.nb(L), extra = n & 31;
      if (extra) out[n32 - 1] = (1 << extra) - 1;
      for (let p = 0; p < L; p++) {
        const ch = grille[s[p]];
        if (ch < 0) continue;
        const base = (p * 26 + ch) * n32;
        for (let b = 0; b < n32; b++) out[b] &= mq[base + b];
      }
      let cnt = 0;
      for (let b = 0; b < n32; b++) {
        let x = out[b];
        x = x - ((x >>> 1) & 0x55555555);
        x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
        cnt += ((((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24);
      }
      return cnt;
    };

    const libre = new Uint8Array(nS);
    for (let i = 0; i < nS; i++) libre[i] = fait[i] ? 0 : 1;
    const conflits = new Int32Array(nS);
    const buf = new Uint32Array(Math.max(...[...ix.n32.values()]));

    const rec = (reste) => {
      if (--budget.n <= 0) throw new Error('budget');
      if (nS - reste > meilleurN) { meilleurN = nS - reste; meilleurG = Int8Array.from(grille); }
      if (reste === 0) return !this.exigerTous || restant.size === 0;
      let best = -1, bCle = null, bCnt = 0;
      for (let i = 0; i < nS; i++) {
        if (!libre[i]) continue;
        const cnt = calc(i, buf);
        if (cnt === 0) { conflits[i]++; return false; }
        const L = segs[i].length;
        // un mot impose non encore pose tient-il ici ?
        let host = 0;
        if (restant.size) {
          for (const m of restant) {
            if (m.length !== L) continue;
            const k = ix.rang.get(L).get(m);
            if (buf[k >> 5] & (1 << (k & 31))) { host = 1; break; }
          }
        }
        // PRIORITE : emplacement long capable d'accueillir un mot impose
        const cle = host ? [0, -L, cnt] : [1, 0, cnt];
        if (bCle === null || cle[0] < bCle[0] ||
          (cle[0] === bCle[0] && (cle[1] < bCle[1] ||
            (cle[1] === bCle[1] && cle[2] < bCle[2])))) {
          best = i; bCle = cle; bCnt = cnt;
          dom[i].set(buf.subarray(0, ix.n32.get(L)));
        }
        if (bCle[0] === 1 && bCnt === 1) break;
      }
      const s = segs[best], L = s.length, n32 = ix.n32.get(L);
      const mots = ix.mots.get(L), d = dom[best];
      const cands = [];
      for (let b = 0; b < n32; b++) {
        let x = d[b];
        while (x) {
          const t = x & -x, k = (b << 5) + (31 - Math.clz32(t));
          x ^= t;
          const m = mots[k];
          let sc = k + this.rnd() * 400;
          if (this.theme.has(m)) sc -= 1e5;      // preference thematique, souple
          if (restant.has(m)) sc -= 1e9;         // mot impose, prioritaire
          cands.push([sc, k]);
        }
      }
      cands.sort((a, b) => a[0] - b[0]);
      libre[best] = 0;
      const rep = maxRepet(L);
      for (let t = 0; t < Math.min(cands.length, 50); t++) {
        const k = cands[t][1], mot = mots[k];
        if ((emploi.get(mot) || 0) >= rep) continue;
        const sauve = [];
        for (let p = 0; p < L; p++) {
          if (grille[s[p]] === VIDE) { sauve.push(s[p]); grille[s[p]] = mot.charCodeAt(p) - 65; }
        }
        emploi.set(mot, (emploi.get(mot) || 0) + 1);
        const etait = restant.delete(mot);
        if (etait) poses++;
        if (rec(reste - 1)) return true;
        if (etait) { restant.add(mot); poses--; }
        emploi.set(mot, emploi.get(mot) - 1);
        for (const idx of sauve) grille[idx] = VIDE;
      }
      libre[best] = 1;
      return false;
    };

    let nLibres = 0;
    for (let i = 0; i < nS; i++) if (libre[i]) nLibres++;
    try { if (rec(nLibres)) return { grille, poses, segs, conflits }; }
    catch (e) { if (e.message !== 'budget') throw e; }
    return { grille: null, poses: -1, segs, conflits, ebauche: meilleurG };
  }

  // Recherche de la densite de noirs la plus faible : on descend par paliers,
  // chaque palier disposant d'un temps fixe, et on recommence x cycles.
  optimiserDensite(o = {}) {
    const dureePalier = o.dureePalier ?? 2000, cycles = o.cycles ?? 4;
    const dMax = o.dMax ?? 0.40, dMin = o.dMin ?? 0.12, pas = o.pas ?? 0.02;
    let meilleur = null, meilleureD = Infinity;
    for (let cy = 0; cy < cycles; cy++) {
      let d = Math.min(dMax, meilleureD - pas);
      if (!isFinite(d)) d = dMax;
      while (d >= dMin) {
        this.pNoir = d;
        const r = this.generer(1e9, o.budget ?? 20000, dureePalier);
        if (!r || r.poses !== this.imposes.length) break;   // palier rate
        const noirs = r.grille.reduce((a, x) => a + (x === NOIR ? 1 : 0), 0);
        const reelle = noirs / (this.nl * this.nc);
        if (reelle < meilleureD) { meilleur = r; meilleureD = reelle; }
        d = Math.min(d, reelle) - pas;
      }
    }
    return meilleur ? { ...meilleur, densite: meilleureD } : null;
  }

  generer(essais = 600, budgetParEssai = 30000, limiteMs = 0) {
    const t0 = Date.now();
    let res = null, motif = null, etat = null, sansGain = 0;
    let meilleur = null, score = -1;
    for (let it = 0; it < essais; it++) {
      if (limiteMs && (it & 15) === 0 && Date.now() - t0 > limiteMs) break;
      if (!res) {
        this.diag.squelette++;
        res = this.imposes.length ? this.squelette()
          : { fixe: new Uint8Array(this.nl * this.nc), lettres: null, liste: [] };
        if (!res) continue;
        motif = null;
      }
      if (!motif) {
        this.diag.motif++;
        motif = this.motif(res.fixe);
        if (!motif) { res = null; continue; }
        etat = null; sansGain = 0;
      }
      // le squelette est toujours reinjecte : ses lettres ne bougent jamais
      let init = etat;
      if (res.lettres) {
        init = etat ? Int8Array.from(etat) : new Int8Array(this.nl * this.nc).fill(VIDE);
        for (let i = 0; i < init.length; i++)
          if (res.lettres[i] >= 0) init[i] = res.lettres[i];
      }
      this.diag.resolution++;
      const r = this.resoudre(motif, { n: budgetParEssai }, init);
      if (r.grille) {
        if (r.poses > score) { meilleur = r; score = r.poses; }
        if (r.poses === this.imposes.length) return meilleur;
      }
      // on garde l'ebauche, mais on relache la region qui coince :
      // les mots loin du conflit sont conserves, ceux d'autour sont effaces
      if (r.ebauche) {
        etat = r.ebauche;
        const ordre = [...r.conflits.keys()].sort((a, b) => r.conflits[b] - r.conflits[a]);
        for (const j of ordre.slice(0, this.relache)) {
          if (r.conflits[j] === 0) break;
          for (const i of r.segs[j]) if (res.fixe[i] !== 2) etat[i] = VIDE;
        }
      }
      if (!this.muter(motif, res.fixe, r.segs, r.conflits)) sansGain += 2;
      if (++sansGain >= this.patience) {
        sansGain = 0;
        etat = null;                       // on relache l'ebauche
        if (this.rnd() < 0.35) motif = null;
        if (this.rnd() < 0.12) res = null;
      }
    }
    return meilleur;
  }
}

function afficher(r, nc) {
  if (!r) return '(aucune solution)';
  const g = r.grille, out = [];
  for (let i = 0; i < g.length; i += nc) {
    out.push([...g.slice(i, i + nc)].map(x => x === NOIR ? '#' : String.fromCharCode(65 + x)).join(' '));
  }
  return out.join('\n');
}

const API = { VERSION, Index, Generateur, afficher, normaliser, NOIR, maxRepet };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
// page, worker ou Node : on expose dans tous les cas
if (typeof globalThis !== 'undefined') {
  globalThis.MotsCroises = API;
  Object.assign(globalThis, API);
}
