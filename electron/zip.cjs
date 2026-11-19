// Lecture / écriture minimale d'archives ZIP (suffisant pour les fichiers .docx), sans dépendance.
const zlib = require('node:zlib');

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// → Map nom → Buffer
function lireZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Ce fichier n'est pas un document Word valide.");
  const nb = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const res = new Map();
  for (let i = 0; i < nb; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive illisible.');
    const methode = buf.readUInt16LE(p + 10);
    const tailleC = buf.readUInt32LE(p + 20);
    const lenNom = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nom = buf.toString('utf8', p + 46, p + 46 + lenNom);
    p += 46 + lenNom + lenExtra + lenCom;
    if (nom.endsWith('/')) continue;
    const debut = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const brut = buf.subarray(debut, debut + tailleC);
    res.set(nom, methode === 0 ? Buffer.from(brut) : methode === 8 ? zlib.inflateRawSync(brut) : (() => { throw new Error('Compression non prise en charge.'); })());
  }
  return res;
}

// entries : Map nom → Buffer. [Content_Types].xml en premier, pas d'entrées de dossier.
function ecrireZip(entries) {
  const noms = [...entries.keys()].sort((a, b) => (a === '[Content_Types].xml' ? -1 : b === '[Content_Types].xml' ? 1 : 0));
  const parts = [];
  const centrale = [];
  let offset = 0;
  for (const nom of noms) {
    const data = entries.get(nom);
    const nomBuf = Buffer.from(nom, 'utf8');
    const brut = /\.(png|jpe?g)$/i.test(nom) ? data : zlib.deflateRawSync(data);
    const methode = brut === data ? 0 : 8;
    const crc = crc32(data);
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4); loc.writeUInt16LE(0x0800, 6); loc.writeUInt16LE(methode, 8);
    loc.writeUInt32LE(crc, 14); loc.writeUInt32LE(brut.length, 18); loc.writeUInt32LE(data.length, 22); loc.writeUInt16LE(nomBuf.length, 26);
    parts.push(loc, nomBuf, brut);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8); cen.writeUInt16LE(methode, 10);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(brut.length, 20); cen.writeUInt32LE(data.length, 24); cen.writeUInt16LE(nomBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrale.push(cen, nomBuf);
    offset += loc.length + nomBuf.length + brut.length;
  }
  const cd = Buffer.concat(centrale);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(noms.length, 8); fin.writeUInt16LE(noms.length, 10);
  fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, fin]);
}

module.exports = { lireZip, ecrireZip };
