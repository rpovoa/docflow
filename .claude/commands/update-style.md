Extrai o guia de estilo do documento de referência e atualiza a extensão DocFlow.

## O que fazer

### 1. Extrair o texto do documento Word

Executa o seguinte comando para converter o .docx em texto simples:

```bash
textutil -convert txt -stdout "docs/reference/ExemploManual.docx" 2>/dev/null
```

Se o comando acima falhar ou retornar vazio, usa este fallback com Python:

```bash
python3 -c "
import zipfile, re, sys
try:
    z = zipfile.ZipFile('docs/reference/ExemploManual.docx')
    xml = z.read('word/document.xml').decode('utf-8')
    text = re.sub(r'<w:br[^/]*/>', '\n', xml)
    text = re.sub(r'</w:p>', '\n', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    print(text)
except Exception as e:
    print(f'ERRO: {e}', file=sys.stderr)
"
```

Se ambos falharem, informa o utilizador que o ficheiro `docs/reference/ExemploManual.docx` não foi encontrado ou está corrompido e pede para o colocar na pasta correta.

### 2. Analisar e criar o guia de estilo

Com o texto extraído, analisa-o e cria um guia de estilo compacto em **Português Europeu (PT-PT)**, máximo 700 palavras, com as seguintes secções:

**TOM E REGISTO**
- Formal/informal, nível de tecnicidade
- Pessoa gramatical usada (o utilizador / tu / você)
- Registo de linguagem (direto, explicativo, imperativo, etc.)

**ESTRUTURA TÍPICA**
- Como o documento abre (título, introdução, objetivo)
- Organização das secções
- Como termina (confirmação, resultado esperado)

**PADRÕES DE ESCRITA DOS PASSOS**
- Verbos usados no início dos passos (ex: "Clique", "Selecione", "Introduza")
- Estrutura de cada passo (ação + resultado esperado)
- Uso de negritos, itálicos, aspas para nomear elementos de UI

**FORMATAÇÃO**
- Passos numerados ou com bullets
- Uso de notas, avisos, dicas
- Comprimento típico de cada passo

**EXEMPLOS REPRESENTATIVOS** (3 a 5 excertos curtos do documento original que melhor ilustram o estilo)

### 3. Guardar o resultado

Guarda o guia de estilo em `docs/reference/style-guide.md`. Usa o formato:

```markdown
# Guia de Estilo — DocFlow

> Extraído automaticamente de ExemploManual.docx. Atualiza correndo `/update-style`.

## Tom e Registo
...

## Estrutura Típica
...

## Padrões de Escrita dos Passos
...

## Formatação
...

## Exemplos Representativos
...
```

### 4. Confirmar ao utilizador

Após guardar:
- Informa quantas palavras tem o guia de estilo gerado
- Lembra que é necessário **recarregar a extensão** em `chrome://extensions` → botão "Atualizar" para que a extensão passe a usar o novo guia
- Se já existia um `style-guide.md` anterior, menciona que foi substituído
