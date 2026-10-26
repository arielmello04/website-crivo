// Sobe o catálogo interno (worker/catalogo.json) para a tabela `catalogo` do D1.
//
// O JSON não vai para o git: o repositório é público e ele tem os preços.
// Edite o arquivo local e rode, de dentro de worker/:  npm run catalogo
import { readFileSync, writeFileSync, rmSync } from 'fs';
import { execSync } from 'child_process';

const dados = JSON.stringify(JSON.parse(readFileSync('catalogo.json', 'utf8')));
const sql = `INSERT INTO catalogo (id, dados, atualizado_em) VALUES (1, '${dados.replace(/'/g, "''")}', datetime('now'))
ON CONFLICT(id) DO UPDATE SET dados = excluded.dados, atualizado_em = excluded.atualizado_em;\n`;

writeFileSync('.catalogo.sql', sql);
try {
  execSync('npx wrangler d1 execute crivo --remote --file=./.catalogo.sql -y', { stdio: 'inherit' });
  console.log('Catálogo atualizado.');
} finally {
  rmSync('.catalogo.sql', { force: true });
}
