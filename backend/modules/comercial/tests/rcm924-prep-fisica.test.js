/**
 * RCM-9.2.4 — Preparação / smoke da homologação física CDS Mobile
 * Valida LAN acessível, shell, CSS/JS, PWA e contratos UX.
 * NÃO declara homologação física (exige aparelho + operador).
 */
const assert = require('assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ROOT = path.resolve(__dirname, '../../../..');
const PORT = process.env.CDS_PORT || 3002;

function lanIpv4s() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const list of Object.values(ifs)) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function get(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, timeout: 6000 },
      (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => resolve({ status: res.statusCode, raw, headers: res.headers }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function tryGet(url) {
  try {
    return await get(url);
  } catch (e) {
    return { status: 0, error: e.message, raw: '' };
  }
}

async function main() {
  console.log('\nRCM-9.2.4 — Smoke pré-homologação física\n');
  const lans = lanIpv4s().filter((ip) => ip.startsWith('192.168.') || ip.startsWith('10.'));
  console.log('IPs LAN detectados:', lans.join(', ') || '(nenhum)');

  const preferred = lans.find((ip) => ip.startsWith('192.168.0.')) || lans[0];
  assert.ok(preferred, 'PC precisa de IP LAN para o celular acessar');

  const stale = '192.168.0.22';
  const stalePing = await tryGet(`http://${stale}:${PORT}/api/ping`);
  const livePing = await tryGet(`http://${preferred}:${PORT}/api/ping`);
  const localPing = await tryGet(`http://127.0.0.1:${PORT}/api/ping`);

  console.log(`stale ${stale}:`, stalePing.status || stalePing.error);
  console.log(`live ${preferred}:`, livePing.status || livePing.error);
  console.log('local 127.0.0.1:', localPing.status || localPing.error);

  assert.ok(localPing.status === 200, 'servidor local deve estar no ar (npm start)');
  assert.ok(livePing.status === 200, `LAN ${preferred}:${PORT} deve responder (firewall/bind)`);

  if (preferred !== stale && stalePing.status !== 200) {
    console.log(`AVISO — URL da sprint antiga http://${stale}:${PORT} NÃO responde. Use http://${preferred}:${PORT}/apps/mobile/`);
  }

  const base = `http://${preferred}:${PORT}`;
  const page = await get(`${base}/apps/mobile/`);
  assert.strictEqual(page.status, 200, 'shell Mobile');
  assert.ok(/mobile\.css/.test(page.raw), 'CSS referenciado');
  assert.ok(/type=["']module["']|app\.js/.test(page.raw), 'JS referenciado');
  assert.ok(/manifest\.webmanifest/.test(page.raw), 'manifest PWA');
  assert.ok(/viewport-fit=cover/.test(page.raw), 'viewport mobile');

  const cssHref = (page.raw.match(/href="(\/apps\/mobile\/css\/mobile\.css[^"]*)"/) || [])[1];
  const css = await get(`${base}${cssHref}`);
  assert.strictEqual(css.status, 200, 'CSS carrega');
  assert.ok(css.raw.includes('white-space: nowrap') && css.raw.includes('cds-pdv-sticky__total-label'), 'sticky nowrap');
  assert.ok(css.raw.includes('flex-direction: column') && css.raw.includes('cds-pdv-sticky__bar'), 'sticky coluna');
  assert.ok(css.raw.includes('--m-touch: 48px'), 'alvo de toque 48px');
  assert.ok(css.raw.includes('overflow-x: clip') || css.raw.includes('overflow-x: hidden'), 'anti scroll-x shell');

  const man = await get(`${base}/apps/mobile/manifest.webmanifest`);
  assert.ok(man.status === 200, 'manifest HTTP');
  const manJson = JSON.parse(man.raw);
  assert.ok(manJson.display === 'standalone', 'PWA standalone');
  assert.ok(String(manJson.start_url || '').includes('/apps/mobile/'), 'start_url Mobile');

  const pdv = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/pages/pdv.js'), 'utf8');
  const terminal = fs.readFileSync(path.join(ROOT, 'frontend/apps/mobile/js/terminal.js'), 'utf8');
  assert.ok(pdv.includes('clearPdvSearchAfterAdd'), 'pesquisa contínua');
  assert.ok(pdv.includes('cds-pdv-sticky__pay'), 'Finalizar sticky');
  assert.ok(terminal.includes('persistTerminal') && terminal.includes('cds_mobile_terminal_caixa_id'), 'reabertura terminal');

  const report = {
    sprint: 'RCM-9.2.4',
    at: new Date().toISOString(),
    lan_ip: preferred,
    url_mobile: `${base}/apps/mobile/`,
    stale_ip_22_ok: stalePing.status === 200,
    smoke_lan: true,
    smoke_assets: true,
    smoke_pwa_manifest: true,
    smoke_ux_contratos: true,
    homologacao_fisica_aparelho: null,
    declaracao: 'Smoke LAN/assets/PWA/UX OK — homologação física exige checklist no celular'
  };
  fs.writeFileSync(path.join(ROOT, 'docs/RCM924_PREP_FISICA_RUNTIME.json'), JSON.stringify(report, null, 2));

  console.log('\nURL CORRETA PARA O CELULAR:', report.url_mobile);
  console.log('Hard refresh após abrir.');
  console.log('\nRCM-9.2.4 SMOKE PRÉ-FÍSICA PASSOU (sem declarar homologação)\n');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
