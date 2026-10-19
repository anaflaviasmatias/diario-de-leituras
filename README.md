# Diário de Leituras

App pessoal para registrar leituras: estante de capas, nota de 1 a 5, resumo, frases favoritas, impressões e um resumo do ano.

- Roda no GitHub Pages e pode ser instalado no celular ("Adicionar à tela inicial").
- Os dados ficam no Supabase, com login por e-mail e senha. Cada conta só vê os próprios livros.

## Arquivos

- `index.html`, `style.css`, `app.js`: o app
- `config.js`: endereço e chave pública do Supabase
- `supabase.sql`: cria a tabela, as regras de acesso e a pasta de capas
- `seed.json` e `capas/`: livros e capas para a importação inicial
- `manifest.webmanifest`, `sw.js`, `icons/`: o que faz o app ser instalável
