# Suivi Absences

Application de bureau Windows pour le suivi des absences, retards et rattrapages
de sept classes en alternance : BTS GPME, MCO et NDRC (1ère et 2ème année) et licence LCVM (3ème année).

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
- [x] Absences et retards (créneaux date + heure de début et de fin, durée calculée automatiquement à la minute, contrôle des doublons, motifs, observations, mail copié, pièces jointes, alertes sur l'accueil)
- [x] Notification de l'entreprise par mail : brouillon ouvert dans l'ancien Outlook (PowerShell), pièces jointes cochées à la main, repli sur mailto
- [ ] À vérifier sous Windows avec le vrai Outlook (non testable hors Windows), y compris Cc / Cci
- [x] Rattrapages (créneaux, total ou partiel, convocation, émargement)
- [x] Calendriers d'alternance 2026-2027 et vacances scolaires zone B (en gris)
- [x] Récapitulatifs mensuels envoyés aux entreprises via Outlook
- [x] Professeurs principaux (affectations datées, remplacement, alertes)
- [x] Historique de classes, bascule de rentrée, sorties de formation
- [x] Historique entreprise / maître d'apprentissage, contrats, photo
- [x] Fiche apprenti : absences et retards, tableau de bord d'assiduité (PDF) ; fiche entreprise : apprentis rattachés
- [x] Recherche (Accueil, Apprentis, Entreprises)
- [ ] Calendriers DTS IMRT (à fournir) et calendriers 2027-2028
- [ ] Statistiques (exports Word / PDF / Excel)
- [x] Sanctions, lot 1 : motifs et paliers, proposition de palier, décision humaine, historique tracé, pièces, communication à l'employeur, professeur principal et représentant légal des mineurs
- [x] Sanctions, lot 2 : commissions pédagogiques et disciplinaires (programmation, participants, statuts, report, compte rendu, convocations Word d'après les modèles de l'établissement, mails Outlook, rappels sur l'Accueil, calendrier)
- [x] Sanctions, lot 3 : alertes automatiques de seuils (retards, absences non recevables en demi-journées, cumul ; seuils et périodes réglables, destinataires, statuts de suivi, journal)
- [ ] Sanctions, lots 4 et 5 : tableau de bord disciplinaire, bibliothèque de mails types
- [ ] Heures de rattrapage non faites à la sortie d'un apprenti
- [ ] Désignation des professeurs principaux après la bascule

## Mot de passe oublié

Le mot de passe ne peut pas être retrouvé depuis l'appli. Pour le réinitialiser sans perdre de données
(appli fermée, Node 22 ou plus) :

```
node scripts/reset-mdp.cjs "<chemin vers suivi-absences.db>"
```

Le dossier des données est affiché dans **Paramètres**. Le mot de passe empêche l'accès à l'appli, mais la base
n'est pas chiffrée : la session Windows doit rester verrouillée quand le poste est laissé sans surveillance.
