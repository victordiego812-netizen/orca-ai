# Orça.AI

MVP de pré-análise de serviços de pintura por foto.

## O que já funciona

- Upload de até 4 fotos
- Coleta de cidade, bairro, ambiente, teto e medidas opcionais
- Análise visual por IA
- Classificação de complexidade
- Materiais prováveis e pontos de atenção
- Faixa experimental de pré-orçamento

## Deploy na Vercel

1. Importe este repositório na Vercel.
2. Em **Settings > Environment Variables**, adicione:
   - `GEMINI_API_KEY` = sua chave da API do Google Gemini
   - opcional: `GEMINI_MODEL` = modelo usado pela análise. Se omitido, o MVP usa `gemini-2.5-flash`.
3. Faça um novo deploy.

## Importante

A faixa de preço atual é propositalmente experimental e ampla. Ela serve apenas para validar a experiência do produto. Antes de uso comercial, o motor de preços deve ser substituído por regras regionais reais, dados de materiais e parâmetros configuráveis pelo profissional.

O Orça.AI não deve prometer diagnóstico técnico, metragem exata por foto ou orçamento definitivo sem vistoria.
