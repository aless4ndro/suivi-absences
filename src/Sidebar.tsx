// Barre latérale « Liquid Glass » : 4 sections repliables, mode réduit (72 px), état mémorisé.
import { useState, type ComponentType } from 'react';
import {
  Home, Calendar, Bell, Clock, GraduationCap, Building2, UserCheck, BarChart3, Gavel, Users,
  CornerUpLeft, ClipboardList, Mail, Filter, FileDown, Settings, Lock, Menu, ChevronDown, CalendarCheck,
  type LucideProps,
} from 'lucide-react';

export type PageId =
  | 'accueil' | 'calendrier' | 'alertes' | 'absences' | 'jeunes' | 'entreprises' | 'professeurs'
  | 'discipline' | 'sanctions' | 'commissions' | 'rattrapages' | 'envois' | 'mails' | 'motifs' | 'import' | 'parametres';

type Icone = ComponentType<LucideProps>;
export interface EntreeMenu { id: PageId; titre: string; icone: Icone }
export interface SectionMenu { id: string; titre: string; entrees: EntreeMenu[] }

export const SECTIONS: SectionMenu[] = [
  { id: 'general', titre: 'Général', entrees: [
    { id: 'accueil', titre: 'Accueil', icone: Home },
    { id: 'calendrier', titre: 'Calendrier', icone: Calendar },
    { id: 'alertes', titre: 'Alertes', icone: Bell },
  ] },
  { id: 'suivi', titre: 'Suivi & scolarité', entrees: [
    { id: 'absences', titre: 'Absences et retards', icone: Clock },
    { id: 'jeunes', titre: 'Apprentis', icone: GraduationCap },
    { id: 'entreprises', titre: 'Entreprises', icone: Building2 },
    { id: 'professeurs', titre: 'Professeurs principaux', icone: UserCheck },
  ] },
  { id: 'discipline', titre: 'Discipline', entrees: [
    { id: 'discipline', titre: 'Tableau de bord disciplinaire', icone: BarChart3 },
    { id: 'sanctions', titre: 'Sanctions', icone: Gavel },
    { id: 'commissions', titre: 'Commissions', icone: Users },
    { id: 'rattrapages', titre: 'Rattrapages', icone: CornerUpLeft },
  ] },
  { id: 'outils', titre: 'Outils', entrees: [
    { id: 'envois', titre: 'Récapitulatifs', icone: ClipboardList },
    { id: 'mails', titre: 'Mails types', icone: Mail },
    { id: 'motifs', titre: 'Motifs', icone: Filter },
    { id: 'import', titre: 'Import de données', icone: FileDown },
    { id: 'parametres', titre: 'Paramètres', icone: Settings },
  ] },
];

export const titreDe = (id: PageId) => SECTIONS.flatMap((s) => s.entrees).find((e) => e.id === id)?.titre ?? '';

const lire = <T,>(cle: string, defaut: T): T => { try { const v = localStorage.getItem(cle); return v ? (JSON.parse(v) as T) : defaut; } catch { return defaut; } };
const ecrire = (cle: string, v: unknown) => { try { localStorage.setItem(cle, JSON.stringify(v)); } catch { /* stockage indisponible : sans conséquence */ } };

interface Props { page: PageId; onNaviguer: (id: PageId) => void; onVerrouiller: () => void; nbAlertes?: number }

export default function Sidebar({ page, onNaviguer, onVerrouiller, nbAlertes }: Props) {
  const [reduit, setReduit] = useState<boolean>(() => lire('menu.reduit', false));
  const [replies, setReplies] = useState<string[]>(() => lire('menu.replies', []));
  const basculerReduit = () => setReduit((r) => { ecrire('menu.reduit', !r); return !r; });
  const basculerSection = (id: string) => setReplies((l) => { const n = l.includes(id) ? l.filter((x) => x !== id) : [...l, id]; ecrire('menu.replies', n); return n; });

  return (
    <nav className={`menu${reduit ? ' reduit' : ''}`} aria-label="Navigation principale">
      <div className="menu-entete">
        <span className="marque-icone"><CalendarCheck size={20} strokeWidth={1.8} /></span>
        {!reduit && <span className="marque-titre">Présencia</span>}
        <button className="menu-burger" onClick={basculerReduit} aria-label={reduit ? 'Déplier le menu' : 'Réduire le menu'} title={reduit ? 'Déplier le menu' : 'Réduire le menu'}>
          <Menu size={18} strokeWidth={1.5} />
        </button>
      </div>
      <div className="menu-liste">
        {SECTIONS.map((s) => {
          const ferme = !reduit && replies.includes(s.id);
          return (
            <div className="menu-section" key={s.id}>
              {reduit ? <div className="menu-sep" /> : (
                <button className="menu-groupe" onClick={() => basculerSection(s.id)} aria-expanded={!ferme}>
                  <span>{s.titre}</span>
                  <ChevronDown size={14} strokeWidth={1.8} className={ferme ? 'tourne' : ''} />
                </button>
              )}
              {!ferme && s.entrees.map((e) => {
                const Ico = e.icone;
                return (
                  <button key={e.id} className={`menu-entree${e.id === page ? ' actif' : ''}`} onClick={() => onNaviguer(e.id)} title={e.titre} aria-current={e.id === page ? 'page' : undefined}>
                    <Ico size={18} strokeWidth={1.5} />
                    {!reduit && <span className="menu-libelle">{e.titre}</span>}
                    {e.id === 'alertes' && !!nbAlertes && <span className={reduit ? 'menu-pastille' : 'badge-n'}>{reduit ? '' : nbAlertes}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <button className="menu-verrou" onClick={onVerrouiller} title={reduit ? 'Verrouiller' : undefined}>
        <Lock size={16} strokeWidth={1.5} />{!reduit && <span>Verrouiller</span>}
      </button>
    </nav>
  );
}
