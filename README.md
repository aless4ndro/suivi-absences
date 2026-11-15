# Suivi Absences

Application de bureau Windows pour le suivi des absences, retards et rattrapages
de quatre classes en alternance (BTS GPME, MCO, NDRC et licence LCVM).

- Mono-poste : les données restent sur le PC, dans une base SQLite locale.
- Technos : Electron, React, Vite, SQLite intégré à Node (`node:sqlite`).

## Récupérer le .exe

Chaque envoi sur `main` compile `SuiviAbsences.exe` : onglet **Actions** du dépôt,
dernière exécution, section **Artifacts**.

## Développement

```
npm install
npm start      # compile l'interface et lance l'appli
npm test       # tests de la base de données
npm run dist   # produit release/SuiviAbsences.exe (sous Windows)
```

## Avancement

- [x] Base du projet, classes, fiches jeunes, entreprises et maîtres d'apprentissage
- [ ] Absences et retards (motifs, observations, mail copié, pièces jointes)
- [ ] Rattrapages (créneaux, total ou partiel, convocation, émargement)
- [ ] Calendrier d'année scolaire
- [ ] Récapitulatif mensuel envoyé aux entreprises via Outlook
