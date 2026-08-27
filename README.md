# Mots croisés — CGExcel

Générateur de mots croisés français, avec mots imposés, préférence thématique,
grilles de forme libre et optimisation de la densité de cases noires.
Application web installable, fonctionnant hors ligne.

© 2026 Cyrille Gindre — marque CGExcel

## Mise en route

1. Récupérer le lexique Grammalecte (formes fléchies, licence MPL 2.0).
2. `python3 outils/convertir.py lexique-grammalecte.txt lexique.txt.gz`
3. Publier le dossier sur GitHub Pages.

## Principe du moteur

- squelette : les mots imposés sont dispersés dans la grille, sans avoir à se croiser ;
- un motif de cases noires est tiré au hasard autour d'eux ;
- le remplissage est un problème de contraintes : chaque emplacement porte un
  domaine de mots codé en masque de bits, résolu par domaine le plus étroit
  avec vérification en avant ;
- en cas d'échec, les cases noires sont déplacées localement là où les conflits
  se concentrent, et l'ébauche déjà cohérente est conservée ;
- la densité est ensuite abaissée par paliers successifs.

## Réglages

| Paramètre | Effet |
|---|---|
| `densiteNoirs` | proportion visée de cases noires |
| `maxMots` | plafond du nombre de mots courts, ex. `{2: 6}` |
| `maxParLong` | niveau de vocabulaire (troncature par fréquence) |
| `masque` | silhouette : 1 = case hors grille |
| `motsImposes` | mots obligatoires |
| `motsThemes` | simple préférence, non contraignante |
