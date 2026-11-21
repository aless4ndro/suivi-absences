// Logo Ikelli Systeme en vectoriel : net à toutes les tailles (remplace l'image PNG).
export default function LogoIkelli({ hauteur = 18, clair = false }: { hauteur?: number; clair?: boolean }) {
  return (
    <svg className="logo-ikelli" height={hauteur} viewBox="0 0 396 100" role="img" aria-label="Ikelli Systeme" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="6" width="88" height="88" rx="17" fill="#1B2F57" />
      <path d="M44 23 L71 50 L44 77 L17 50 Z" fill="#B06F3F" />
      <text x="108" y="68" fontFamily="Georgia, 'Times New Roman', serif" fontSize="47" fontWeight="600" fill={clair ? '#E2E8F0' : '#14213A'}>Ikelli Systeme</text>
    </svg>
  );
}
