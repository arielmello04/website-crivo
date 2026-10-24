// Monta dist/ com APENAS os arquivos públicos do site.
//
// O Worker serve estes arquivos como assets estáticos. A pasta publicada é
// exatamente esta, então apontar para a raiz do repositório colocaria o código
// de backend/ e worker/ no ar como arquivo servível. Por isso a lista é
// explícita: só entra no dist/ o que está declarado aqui.
//
// Uso: node build-site.mjs   ->   depois: cd worker && wrangler deploy

import { mkdirSync, copyFileSync, rmSync, existsSync, writeFileSync, readdirSync } from 'fs';

const PUBLICOS = ['index.html', 'interno.html', 'questionario.html'];
const DIST = 'worker/dist';

// Esvazia o conteúdo em vez de remover a pasta. No Windows, um `wrangler dev`
// aberto (ou o antivírus varrendo) mantém um handle no diretório e o rmSync
// recursivo falha com EPERM, mesmo com o processo já encerrado. Apagar arquivo
// a arquivo não esbarra nisso.
mkdirSync(DIST, { recursive: true });
for (const entrada of readdirSync(DIST)) {
  rmSync(`${DIST}/${entrada}`, { recursive: true, force: true });
}

for (const f of PUBLICOS) {
  if (!existsSync(f)) throw new Error('arquivo público ausente: ' + f);
  copyFileSync(f, `${DIST}/${f}`);
  console.log('  + ' + f);
}

// Sem um 404.html no topo, o Cloudflare Pages trata o site como SPA e devolve
// a home para qualquer caminho inexistente — inclusive links de questionário
// digitados errado, que apareceriam como a landing em vez de erro.
const html404 = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Página não encontrada · Crivo & Co.</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #f5f1ea; color: #1a1614;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 2rem; text-align: center;
  }
  .num { font-family: 'Courier New', monospace; font-size: 11px; letter-spacing: .15em; color: #c54a1a; text-transform: uppercase; }
  h1 { font-family: Georgia, serif; font-weight: 300; font-size: 40px; letter-spacing: -.02em; margin: 12px 0 16px; line-height: 1.1; }
  p { color: #4a4540; font-size: 16px; line-height: 1.6; max-width: 420px; margin: 0 auto 28px; }
  a { display: inline-block; background: #1a1614; color: #f5f1ea; text-decoration: none;
      padding: 14px 28px; font-family: 'Courier New', monospace; font-size: 12px;
      text-transform: uppercase; letter-spacing: .12em; transition: background .3s; }
  a:hover { background: #c54a1a; }
</style>
</head>
<body>
  <div>
    <div class="num">Erro 404</div>
    <h1>Essa página não existe.</h1>
    <p>O endereço pode estar incompleto ou o link pode ter expirado. Se você recebeu um link de questionário da nossa equipe, confira se ele foi copiado inteiro.</p>
    <a href="/">Voltar para o início</a>
  </div>
</body>
</html>
`;
writeFileSync(`${DIST}/404.html`, html404);
console.log('  + 404.html (gerado)');

console.log('\ndist/ pronto com ' + (PUBLICOS.length + 1) + ' arquivos.');
