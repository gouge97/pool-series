# Pool des Séries NHL

Application web statique pour suivre un pool de séries éliminatoires NHL. Hébergée sur GitHub Pages, elle tire les résultats en direct depuis l'API publique NHL et calcule les points et probabilités pour chaque participant.

## Fonctionnalités

- Classement avec points acquis, points projetés et choix de la Coupe Stanley
- Onglet par ronde avec détail des choix de chaque participant
- Résultats en direct (API NHL, rafraîchissement toutes les 5 minutes)
- Probabilités basées sur les forces relatives des équipes (win% saison régulière)
- Interface mobile-friendly, thème sombre

## Structure des fichiers

```
├── index.html
├── css/
│   └── style.css
├── js/
│   └── app.js
└── data/
    ├── config.json   ← noms des participants, saison
    └── picks.json    ← choix de chaque participant
```

## Configuration

### `data/config.json`

```json
{
  "poolName": "Pool des séries 2026",
  "season": 2026,
  "participants": ["Martin", "Julien", "Philippe", "Maxime", "Michaël", "Marc-André"]
}
```

### `data/picks.json`

Structure par participant. Les séries sont définies une seule fois dans `series[]`, et chaque participant a un tableau de choix indexé dans le même ordre.

```json
{
  "stanleyCupPick": {
    "Martin": "DAL"
  },
  "rounds": {
    "1": {
      "series": [
        { "team1": "BUF", "team2": "BOS" }
      ],
      "picks": {
        "Martin": [
          { "winner": "BOS", "games": 6 }
        ]
      }
    },
    "2": {},
    "3": {},
    "4": {}
  }
}
```

Les codes d'équipe correspondent aux abréviations officielles NHL (ex: `BOS`, `MTL`, `TBL`, `VGK`, `UTA`, `EDM`…).

## Système de points

| Ronde | Bonne équipe | Bon nombre de matchs |
|-------|-------------|----------------------|
| 1     | 2 pts       | 1 pt                 |
| 2     | 4 pts       | 2 pts                |
| Finales de conférence | 6 pts | 3 pts      |
| Finale de la Coupe    | 8 pts | 4 pts      |

**Bonus Coupe Stanley :** +10 pts si le participant a choisi le bon champion en début de tournoi.

## Mise à jour des picks (rondes 2, 3, 4)

1. Ajouter les séries dans `picks.json` sous la ronde concernée
2. Ajouter les choix de chaque participant dans le même ordre
3. Commit + push → le site se met à jour automatiquement

Exemple pour la ronde 2 :
```json
"2": {
  "series": [
    { "team1": "BOS", "team2": "CAR" },
    { "team1": "COL", "team2": "DAL" }
  ],
  "picks": {
    "Martin": [
      { "winner": "BOS", "games": 5 },
      { "winner": "DAL", "games": 7 }
    ]
  }
}
```

## Déploiement (GitHub Pages)

Le site est hébergé gratuitement sur GitHub Pages. Chaque push sur la branche `main` redéploie automatiquement.

Pour mettre à jour le site :
1. Modifier les fichiers dans le dossier local (typiquement `data/picks.json`)
2. Ouvrir **GitHub Desktop**
3. Vérifier les changements → écrire un message de commit → **Commit to main**
4. Cliquer **Push origin**

Le site est accessible à : `https://[username].github.io/[nom-du-repo]/`

## Sources de données

- **Résultats NHL en direct** : `https://api-web.nhle.com/v1/playoff-bracket/{saison}`
- **Classements saison régulière** (pour les probabilités) : `https://api-web.nhle.com/v1/standings/now`
- **Logos équipes** : `https://assets.nhle.com/logos/nhl/svg/{CODE}_light.svg`
