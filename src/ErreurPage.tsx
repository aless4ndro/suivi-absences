// Si une page plante, le menu et la barre du haut restent utilisables : on affiche un message à la place de la page.
import { Component, type ReactNode } from 'react';

export default class ErreurPage extends Component<{ children: ReactNode }, { erreur: Error | null }> {
  state = { erreur: null as Error | null };
  static getDerivedStateFromError(erreur: Error) { return { erreur }; }
  render() {
    if (!this.state.erreur) return this.props.children;
    return (
      <section className="fiche">
        <h2>Cette page n'a pas pu s'afficher</h2>
        <p className="discret">Choisissez une autre page dans le menu, puis revenez. Si le problème continue, notez ce message : {this.state.erreur.message}</p>
      </section>
    );
  }
}
