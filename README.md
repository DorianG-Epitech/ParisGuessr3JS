# Paris Guessr — version Three.js

Un GeoGuessr de Paris en 3D, directement dans le navigateur (ordinateur et mobile), recréé à partir des données 3D de l'IGN, en rendu « outlined » sans aucune texture.

**Jouer : https://doriang-epitech.github.io/ParisGuessr3JS/**

C'est la version principale de Paris Guessr (Three.js + Vite). L'ancienne [version Unity](https://github.com/DorianG-Epitech/ParisGuessr) n'est plus maintenue.

![Rue](screenshots/rue.png)

## Principe

- Tu atterris en vue FPS dans une rue aléatoire de Paris (6 000 points de départ dans les 20 arrondissements).
- Tu te promènes pour trouver des indices. Comme sur GeoGuessr, la carte reste affichée en petit en bas à droite : survole-la (ou appuie sur M) pour l'agrandir, clique pour poser ton repère, puis **Deviner**. Sur mobile, touche la mini-carte pour l'ouvrir en plein écran.
- Score de base de la manche : `5000 × e^(−distance / 1200 m)` (5 000 si tu es à moins de 25 m), puis les indices utilisés s'appliquent (voir ci-dessous).
- Après chaque manche, **Se déplacer** te laisse te balader librement autour du vrai lieu. La mini-carte montre alors le vrai lieu (vert), ton repère (rouge) et ta position (flèche bleue).
- Une partie dure 5 manches, avec un récapitulatif à la fin (indices compris) et un bouton Rejouer.

## Indices

Chaque indice est utilisable une fois par manche. Le jeu demande une confirmation avant de l'appliquer.

| Indice | Effet | Coût |
|---|---|---|
| Lignes métro/RER | trace les lignes de métro et de RER sur la carte, avec leurs couleurs (sans numéros) | −1 500 points |
| Arrondissement | affiche l'arrondissement et surligne ses limites sur la carte | score ÷ 2 |
| Prendre de la hauteur | vue aérienne à environ 115 m, on regarde autour de soi puis on revient dans la rue (bouton à bascule) | score ÷ 2 |

Les coûts s'appliquent toujours dans le même ordre : d'abord −1 500 (sans descendre sous 0), puis ÷ 2 pour chaque autre indice. Exemple avec les trois : `(3 702 − 1 500) ÷ 2 ÷ 2 = 551 pts`. Le calcul est affiché sur l'écran de résultat. La vue aérienne redevient gratuite pendant la balade après la manche.

![Indices](screenshots/indices.png)

## Contrôles

| | Ordinateur | Mobile |
|---|---|---|
| Regarder | souris (clic pour capturer le pointeur) | glisser sur la moitié droite |
| Marcher | ZQSD / WASD / flèches | joystick (moitié gauche) |
| Courir | Maj | pousser le joystick à fond |
| Carte | survol de la mini-carte, M pour l'agrandir | toucher la mini-carte, bouton Réduire |
| Deviner | Espace ou Entrée, bouton Deviner | bouton Deviner |
| Retour au départ | R | bouton Départ |
| Zoom carte | molette, + / − | pincer, + / − |

## Rendu outlined

- **Faces** : couleurs plates par vertex (façades, toits mansardés, trottoirs, chaussée, verdure, eau), avec un léger éclairage directionnel et un brouillard linéaire (60 à 330 m, 270 m sur mobile).
- **Contours** : de vraies lignes à épaisseur constante en pixels. Chaque segment devient un quad étendu dans le vertex shader à partir de l'extrémité opposée, puis rapproché de la caméra pour passer devant ses faces. Les arêtes de bâtiments, les toits, les bordures de trottoir et les étages (traits fins tous les 3 m) sont dessinés ainsi.
- **Arbres** : contour par « coque inversée », c'est-à-dire les faces arrière gonflées d'un nombre constant de pixels.
- **Routes** : mêmes couleurs que la carte 2D. Les grands axes (importance IGN 1–2 et voies autoroutières) sont jaunes, les axes d'importance 3 sont jaune clair et les autres rues sont blanches.

## Arbres

Les 198 864 arbres de Paris (hors bâtiments) ont une forme qui dépend de leur genre botanique :

| Forme | Genres | Arbres |
|---|---|---|
| Rond (tilleul, érable, sophora…) | les autres genres | 88 518 |
| Platane : couronne large à deux lobes, tronc clair | *Platanus* | 40 114 |
| Marronnier : dôme dense, vert foncé | *Aesculus* | 22 847 |
| Fleuri, rose (cerisier, pommier, magnolia…) | *Prunus, Malus, Cercis, Magnolia…* | 16 506 |
| Petit ornemental | *Pyrus, Corylus, Crataegus, Sorbus…* | 13 316 |
| Conifère : deux cônes empilés | *Pinus, Taxus, Cedrus, Chamaecyparis…* | 11 315 |
| Élancé (peuplier, ginkgo, bouleau, tulipier) | *Populus, Ginkgo, Betula, Liriodendron* | 6 248 |

La hauteur vient du jeu de données. Si elle manque ou n'est pas plausible, elle est estimée à partir de la circonférence ou du stade de développement. Le tronc a son vrai diamètre, et la couronne est limitée par la distance au bâtiment le plus proche pour ne pas traverser les façades.

## Stations de métro

Les 953 accès au métro dans l'emprise du jeu sont placés à leur vraie position et orientés dans l'axe de la rue. Chacun est une trémie avec ses marches et sa balustrade, et on ne peut pas tomber dedans. Il y a deux modèles : un mât avec le disque jaune « M » ou un portique vert avec lanternes inspiré de Guimard. Le modèle est tiré au hasard, car les données ne précisent pas le type d'entrée. Il n'y a ni numéro de ligne ni nom de station, pour ne pas donner la réponse.

![Arbres et métro](screenshots/arbres_metro.png)
- Toute la géométrie est extrudée dans le navigateur à partir d'empreintes compactes.

## Monuments

Les monuments les plus connus ont un modèle 3D low-poly fait à la main, dans le même style outlined :

- tour Eiffel, Notre-Dame, arc de Triomphe, Sacré-Cœur ;
- pyramide du Louvre (et les trois petites pyramides), Panthéon, Invalides, Opéra Garnier ;
- tour Montparnasse, Centre Pompidou, Grand Palais, Madeleine, Saint-Sulpice.

Chaque modèle est construit en code (`src/landmarks.js`) : les volumes principaux reprennent les emprises exactes de la BD TOPO, puis on ajoute les détails (dômes, tours, colonnades, verrières, treillis de la tour Eiffel, tuyaux colorés de Beaubourg…). Les modèles sont placés à leur vraie position, avec la bonne orientation et à l'échelle. Les bâtiments IGN d'origine sont masqués à leur place.

Les modèles sont chargés uniquement quand le joueur s'approche. Les plus hauts (tour Eiffel, Montparnasse, Sacré-Cœur, Invalides, Panthéon, Notre-Dame) restent visibles de loin, en silhouette dans la brume. Aucun nom n'est affiché, pour ne pas donner la réponse.

![Notre-Dame](screenshots/monuments.png)

## Données

Paris est découpé en 3 073 tuiles de 250 m au format binaire `PGT2`, soit environ 12 Ko gzippés par tuile et 36,5 Mo au total. Chaque tuile contient le relief, les emprises de bâtiments avec leurs hauteurs, les routes avec leurs largeurs et leur classe de couleur, les bordures, les arbres avec leur forme et les accès au métro. Le jeu ne télécharge que les tuiles proches du joueur, dans un rayon de 420 m (340 m sur mobile). Une rue est prête en 0,2 à 0,4 s.

Pour régénérer les tuiles : `python3 tools/build_tiles.py`. Le script a besoin des données brutes IGN, des arbres et des accès métro dans `$PG_DATA`, voir les scripts `fetch_*` du [repo Unity](https://github.com/DorianG-Epitech/ParisGuessr/tree/main/Tools). Les accès métro viennent des jeux IDFM `acces`, `relations-acces` et `zones-d-arrets`. Les monuments : `tools/landmarks_extract.py` extrait les emprises IGN autour de chaque monument, puis `tools/landmarks_gen.py` produit `public/data/landmarks.json`. Les indices : `tools/build_hints.py` produit `public/data/hints.json` (26 Ko, 12 Ko gzippé) à partir des tracés IDFM et des limites d'arrondissements IGN. La carte et les points de départ viennent du projet Unity (`tools/prepare_data.py`).

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
- `landmarks.js` : monuments ;
- `main.js` : jeu, entrées, mini-carte, indices et interface.

## Crédits

- **IGN, BD TOPO®** (bâtiments, routes, hydrographie, végétation, arrondissements) et **RGE ALTI®** (relief), via la Géoplateforme : Licence Ouverte Etalab 2.0.
- **Ville de Paris, « Les arbres »** (opendata.paris.fr) : Open Database License (ODbL).
- **Île-de-France Mobilités, « Référentiel des arrêts : Accès »**, relations accès et zones d'arrêts (data.iledefrance-mobilites.fr) : Licence Ouverte Etalab 2.0.
- **Île-de-France Mobilités, « Traces du réseau ferré IDF »** (data.iledefrance-mobilites.fr) : Licence Ouverte Etalab 2.0, pour l'indice métro/RER.
- [Three.js](https://threejs.org) (MIT) et [fflate](https://github.com/101arrowz/fflate) (MIT).
