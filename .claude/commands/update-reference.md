Deteta os ficheiros DOCX e XLSX na pasta `docs/reference/` e atualiza o `index.json` para que a extensão DocFlow os utilize automaticamente durante a geração de documentos.

## O que fazer

### 1. Listar os ficheiros de referência

```bash
find docs/reference -maxdepth 1 \( -name "*.docx" -o -name "*.xlsx" -o -name "*.txt" -o -name "*.md" -o -name "*.csv" \) | sort
```

Se não houver ficheiros (além do `style-guide.md`), informa o utilizador e termina.

### 2. Ler o conteúdo de cada ficheiro

Para cada ficheiro encontrado, extrai o texto usando os seguintes comandos:

**DOCX:**
```bash
textutil -convert txt -stdout "docs/reference/FICHEIRO.docx" 2>/dev/null
```
Fallback Python se textutil falhar:
```bash
python3 -c "
import zipfile, re, sys
try:
    z = zipfile.ZipFile('docs/reference/FICHEIRO.docx')
    xml = z.read('word/document.xml').decode('utf-8')
    text = re.sub(r'<w:br[^/]*/>', '\n', xml)
    text = re.sub(r'</w:p>', '\n', text)
    text = re.sub(r'</w:tc>', '\t', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    print(text)
except Exception as e:
    print(f'ERRO: {e}', file=sys.stderr)
"
```

**XLSX:**
```bash
python3 -c "
import zipfile, re, sys
try:
    z = zipfile.ZipFile('docs/reference/FICHEIRO.xlsx')
    # Shared strings
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        xml = z.read('xl/sharedStrings.xml').decode('utf-8')
        ss = [re.sub(r'<[^>]+>', '', m).strip() for m in re.findall(r'<si>[\s\S]*?</si>', xml)]
    # Sheets
    sheets = sorted([n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml', n)])
    rows = []
    for sheet in sheets:
        xml = z.read(sheet).decode('utf-8')
        for row in re.findall(r'<row[^>]*>([\s\S]*?)</row>', xml):
            cells = []
            for attrs, inner in re.findall(r'<c([^>]*)>([\s\S]*?)</c>', row):
                v = re.search(r'<v>([^<]*)</v>', inner)
                if v:
                    val = ss[int(v.group(1))] if 't=\"s\"' in attrs and int(v.group(1)) < len(ss) else v.group(1)
                    cells.append(val)
                else:
                    cells.append('')
            if any(cells):
                rows.append('\t'.join(cells))
    print('\n'.join(rows))
except Exception as e:
    print(f'ERRO: {e}', file=sys.stderr)
"
```

**TXT / MD / CSV:** lê diretamente com `cat`.

### 3. Decidir o `label` de cada ficheiro

Para cada ficheiro, analisa o conteúdo extraído e cria um label descritivo curto (máx. 60 caracteres) que explique o que o ficheiro contém. Exemplos:
- `ExemploManual.docx` → `"Manual de Referência — Criação de Entidade Bancária"`
- `Campos_Sistema.xlsx` → `"Tabela de Campos — Módulo de Entidades"`
- `Glossario.md` → `"Glossário de Termos do Sistema"`

### 4. Atualizar o `index.json`

Gera o ficheiro `docs/reference/index.json` com todos os ficheiros encontrados (exceto `style-guide.md`):

```json
{
  "files": [
    { "name": "FICHEIRO1.docx", "label": "LABEL1" },
    { "name": "FICHEIRO2.xlsx", "label": "LABEL2" }
  ]
}
```

**Regras:**
- Inclui apenas ficheiros que existem fisicamente na pasta
- Ordena por nome
- Exclui `style-guide.md` (é gerido pelo `/update-style`)
- Não inclui ficheiros cujo conteúdo não conseguiste extrair

### 5. Confirmar ao utilizador

Após guardar o `index.json`, mostra:
- Quantos ficheiros foram adicionados ao índice
- O nome e label de cada um
- Lembra que é necessário **recarregar a extensão** em `chrome://extensions` → botão "Atualizar"
- Informa que estes ficheiros serão agora lidos automaticamente em cada geração de documento
