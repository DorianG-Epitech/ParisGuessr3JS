# Paris Guessr — version Three.js

Un GeoGuessr de Paris en 3D, directement dans le navigateur (ordinateur et mobile), recréé à partir des données 3D de l'IGN, en rendu « outlined » sans aucune texture.

**Jouer : https://doriang-epitech.github.io/ParisGuessr3JS/**

C'est la version web native (Three.js + Vite, sans Unity) du [Paris Guessr Unity](https://github.com/DorianG-Epitech/ParisGuessr) : mêmes données, même gameplay, même rendu, mais un téléchargement initial d'environ 2,5 Mo au lieu d'environ 18 Mo.

![Rue](screenshots/rue.png)

## Principe

- Tu atterris en vue FPS dans une rue aléatoire de Paris (6 000 points de départ dans les 20 arrondissements).
- Tu te promènes pour trouver des indices, puis tu ouvres la carte et tu poses ton repère.
- Score de la manche : `5000 × e^(−distance / 1200 m)` (5 000 si tu es à moins de 25 m).
- Une partie dure 5 manches, avec un récapitulatif à la fin et un bouton Rejouer.

## Contrôles

| | Ordinateur | Mobile |
|---|---|---|
| Regarder | souris (clic pour capturer le pointeur) | glisser sur la moitié droite |
| Marcher | ZQSD / WASD / flèches | joystick (moitié gauche) |
| Courir | Maj | pousser le joystick à fond |
| Carte | M ou Espace | bouton CARTE |
| Retour au départ | R | bouton Départ |
| Zoom carte | molette, + / − | pincer, + / − |

## Rendu outlined

- **Faces** : couleurs plates par vertex (façades, toits mansardés, trottoirs, chaussée, verdure, eau), avec un léger éclairage directionnel et un brouillard linéaire (60 à 330 m, 270 m sur mobile).
- **Contours** : de vraies lignes à épaisseur constante en pixels. Chaque segment devient un quad étendu dans le vertex shader à partir de l'extrémité opposée, puis rapproché de la caméra pour passer devant ses faces. Les arêtes de bâtiments, les toits, les bordures de trottoir et les étages (traits fins tous les 3 m) sont dessinés ainsi.
- **Arbres** : contour par « coque inversée », c'est-à-dire les faces arrière gonflées d'un nombre constant de pixels.
- Toute la géométrie est extrudée dans le navigateur à partir d'empreintes compactes.

## Données

Paris est découpé en 3 073 tuiles de 250 m au format binaire `PGT1`, soit environ 12 Ko gzippés par tuile et 36 Mo au total. Chaque tuile contient le relief, les emprises de bâtiments avec leurs hauteurs, les routes avec leurs largeurs, les bordures et les arbres. Le jeu ne télécharge que les tuiles proches du joueur, dans un rayon de 420 m (340 m sur mobile). Une rue est prête en 0,2 à 0,4 s.

Pour régénérer `public/data/` à partir des tuiles du projet Unity : `npm run data` (voir `tools/prepare_data.py`).

## Développement

```bash
npm install
npm run dev       # serveur local
npm run build     # build dans docs/ (servi par GitHub Pages)
```

Le code se trouve dans `src/` :

- `world.js` : métadonnées et points de départ ;
- `tilebuilder.js` : extrusion des tuiles ;
- `streamer.js` : chargement en continu, sol et collisions ;
- `shaders.js` : faces, lignes et coque ;
- `main.js` : jeu, entrées, carte et interface.

## Crédits

- **IGN, BD TOPO®** (bâtiments, routes, hydrographie, végétation, arrondissements) et **RGE ALTI®** (relief), via la Géoplateforme : Licence Ouverte Etalab 2.0.
- **Ville de Paris, « Les arbres »** (opendata.paris.fr) : Open Database License (ODbL).
- [Three.js](https://threejs.org) (MIT) et [fflate](https://github.com/101arrowz/fflate) (MIT).
