# -*- coding: utf-8 -*-
"""Grammalecte -> lexique.txt.gz (un mot par ligne, du plus frequent au plus rare).

Usage : python3 outils/convertir.py lexique-grammalecte.txt lexique.txt.gz
"""
import gzip, re, sys, unicodedata

SRC, DST = sys.argv[1], sys.argv[2]
LMIN, LMAX = 2, 16
RE_MOT = re.compile(r"^[A-Z]+$")


def norm(m):
    m = m.replace("\u0153", "oe").replace("\u0152", "OE")
    m = m.replace("\u00e6", "ae").replace("\u00c6", "AE")
    m = unicodedata.normalize("NFD", m)
    return "".join(c for c in m if unicodedata.category(c) != "Mn").upper().strip()


ouvre = gzip.open if SRC.endswith(".gz") else open
with ouvre(SRC, "rt", encoding="utf-8") as f:
    entete = f.readline().rstrip("\n").split("\t")
    print("Colonnes detectees :", entete)
    i_freq = None
    for i, nom in enumerate(entete):
        if any(k in nom.lower() for k in ("freq", "fr\u00e9q", "indice")):
            i_freq = i
    print("Colonne de frequence :", i_freq if i_freq is not None else "(aucune)")

    vus = {}
    for ligne in f:
        ch = ligne.rstrip("\n").split("\t")
        if not ch or not ch[0]:
            continue
        m = norm(ch[0])
        if not RE_MOT.match(m) or not (LMIN <= len(m) <= LMAX):
            continue
        try:
            fr = float(ch[i_freq]) if i_freq is not None else 0.0
        except (IndexError, ValueError):
            fr = 0.0
        if m not in vus or vus[m] < fr:
            vus[m] = fr

mots = sorted(vus.items(), key=lambda x: (-x[1], x[0]))
with gzip.open(DST, "wt", encoding="utf-8") as g:
    g.write("\n".join(m for m, _ in mots))
print(f"{len(mots)} mots ecrits dans {DST}")
