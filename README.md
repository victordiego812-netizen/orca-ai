# Orça.AI

MVP de pré-análise de serviços de pintura residencial por foto, calibrado nesta fase para Sorocaba/SP.

## O que já funciona

- Cadastro e login com Supabase Auth
- Plano Free com limite mensal
- Upload de 2 a 4 fotos com compressão no navegador
- Coleta de ambiente, escopo, teto e medidas opcionais
- Análise visual por IA
- Classificação de complexidade, estado aparente, materiais e pontos de atenção
- Pré-orçamento regional com cálculo por metragem quando as medidas são informadas
- Histórico das análises
- Estrutura do plano Pro
- Perfil profissional e regras próprias de precificação salvas no Supabase
- Precificação personalizada para contas Pro quando há metragem informada

## Deploy na Vercel

Em **Settings > Environment Variables**, configure:

- `GEMINI_API_KEY` = chave da API do Google Gemini
- opcional: `GEMINI_MODEL` = modelo preferido. Se omitido, o backend tenta `gemini-3.5-flash-lite` e usa `gemini-3.5-flash` como fallback.

## Arquitetura de preço

A IA faz a triagem visual. Ela não decide o preço.

O valor é calculado por regras determinísticas no backend. Sem medidas, o sistema usa uma faixa regional ampla. Com medidas, calcula a área pintável e separa mão de obra e materiais. Contas Pro podem usar uma base própria de mão de obra por m² e adicionais configurados pelo profissional.

## Importante

O Orça.AI é uma ferramenta de pré-análise e pré-orçamento remoto. Não deve prometer diagnóstico técnico, metragem exata por foto ou orçamento definitivo sem vistoria quando as condições do serviço exigirem confirmação presencial.
