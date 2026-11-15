// Mot de passe de l'application : stocké haché (scrypt + sel), jamais en clair.
const crypto = require('node:crypto');

const LONGUEUR_MIN = 8;
const ESSAIS_MAX = 5;
const BLOCAGE_MS = 30_000;

function hasher(mdp) {
  const sel = crypto.randomBytes(16);
  const h = crypto.scryptSync(mdp, sel, 64);
  return `scrypt$${sel.toString('hex')}$${h.toString('hex')}`;
}

function verifier(mdp, stocke) {
  const [algo, sel, h] = String(stocke).split('$');
  if (algo !== 'scrypt' || !sel || !h) return false;
  const attendu = Buffer.from(h, 'hex');
  const calcule = crypto.scryptSync(String(mdp), Buffer.from(sel, 'hex'), attendu.length);
  return crypto.timingSafeEqual(calcule, attendu);
}

function valider(mdp) {
  if (typeof mdp !== 'string' || mdp.length < LONGUEUR_MIN) {
    throw new Error(`Le mot de passe doit faire au moins ${LONGUEUR_MIN} caractères.`);
  }
}

// `getDb` est une fonction : la base peut être rouverte (restauration).
function creerSession(getDb, maintenant = Date.now) {
  let deverrouille = false;
  let echecs = 0;
  let bloqueJusqua = 0;
  const stocke = () => getDb().lireReglage('mdp');

  return {
    etat: () => ({ mdpDefini: !!stocke(), deverrouille: !!stocke() && deverrouille }),
    estOuvert: () => !!stocke() && deverrouille,

    definir(mdp) {
      if (stocke()) throw new Error('Un mot de passe existe déjà.');
      valider(mdp);
      getDb().ecrireReglage('mdp', hasher(mdp));
      deverrouille = true;
    },

    connecter(mdp) {
      if (!stocke()) throw new Error("Aucun mot de passe n'est défini.");
      const reste = bloqueJusqua - maintenant();
      if (reste > 0) throw new Error(`Trop d'essais. Réessayez dans ${Math.ceil(reste / 1000)} secondes.`);
      if (verifier(mdp, stocke())) {
        echecs = 0;
        deverrouille = true;
        return;
      }
      if (++echecs >= ESSAIS_MAX) {
        echecs = 0;
        bloqueJusqua = maintenant() + BLOCAGE_MS;
      }
      throw new Error('Mot de passe incorrect.');
    },

    changer(ancien, nouveau) {
      if (!this.estOuvert()) throw new Error('Application verrouillée.');
      if (!verifier(ancien, stocke())) throw new Error('Ancien mot de passe incorrect.');
      valider(nouveau);
      getDb().ecrireReglage('mdp', hasher(nouveau));
    },

    verrouiller() {
      deverrouille = false;
    },
  };
}

module.exports = { hasher, verifier, creerSession, LONGUEUR_MIN };
