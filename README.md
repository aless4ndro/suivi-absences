# Suivi Absences

Application de bureau Windows pour le suivi des absences, retards et rattrapages
de quatre classes en alternance (BTS GPME, MCO, NDRC et licence LCVM).

- Mono-poste : les données restent sur le PC, dans une base SQLite locale.
- Pièces jointes : stockées dans la base (10 Mo maximum par fichier), donc incluses dans les sauvegardes.
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

- [x] Base du projet, classes, fiches apprentis, entreprises et maîtres d'apprentissage
- [x] Connexion par mot de passe (haché, blocage 30 s après 5 échecs)
- [x] Sauvegarde et restauration de la base (page Paramètres)
- [x] Section Motifs (recevable / irrecevable)
- [x] Absences et retards (durée à la minute, motifs, observations, mail copié, pièces jointes, alertes sur l'accueil)
- [ ] Envoi du mail à l'entreprise dès l'absence (dépend du type d'Outlook)
- [ ] Rattrapages (créneaux, total ou partiel, convocation, émargement)
- [ ] Calendrier d'année scolaire
- [ ] Récapitulatif mensuel envoyé aux entreprises via Outlook

## Mot de passe oublié

Le mot de passe ne peut pas être retrouvé depuis l'appli. Pour le réinitialiser sans perdre de données
(appli fermée, Node 22 ou plus) :

```
node scripts/reset-mdp.cjs "<chemin vers suivi-absences.db>"
```

Le dossier des données est affiché dans **Paramètres**. Le mot de passe empêche l'accès à l'appli, mais la base
n'est pas chiffrée : la session Windows doit rester verrouillée quand le poste est laissé sans surveillance.
