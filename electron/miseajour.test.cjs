const test = require('node:test');
const assert = require('node:assert/strict');
const { comparer, choisirMiseAJour, PREFIXE_TELECHARGEMENT, NOM_INSTALLATEUR } = require('./miseajour.cjs');

const rel = (tag, extra = {}) => ({ tag_name: tag, draft: false, assets: [{ name: NOM_INSTALLATEUR, size: 100, browser_download_url: `${PREFIXE_TELECHARGEMENT}${tag}/${NOM_INSTALLATEUR}` }], ...extra });

test('comparaison de versions', () => {
  assert.ok(comparer('0.10.0', '0.9.9') > 0);
  assert.equal(comparer('v1.0.0', '1.0.0'), 0);
  assert.ok(comparer('0.9.1', '0.9.2') < 0);
  assert.equal(comparer('abc', '1.0.0'), null);
});

test('retient la plus récente, ignore brouillons, anciennes versions et assets étrangers', () => {
  const m = choisirMiseAJour([rel('v0.9.1'), rel('v0.9.3'), rel('v0.9.4', { draft: true }), rel('v0.9.2')], '0.9.1');
  assert.equal(m.version, '0.9.3');
  assert.equal(choisirMiseAJour([rel('v0.9.1')], '0.9.1'), null);
  const pirate = rel('v9.9.9'); pirate.assets[0].browser_download_url = 'https://exemple.test/x.exe';
  assert.equal(choisirMiseAJour([pirate], '0.9.0'), null);
  assert.equal(choisirMiseAJour(null, '0.9.0'), null);
});
