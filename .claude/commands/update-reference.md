Deteta os ficheiros DOCX e XLSX na pasta `docs/reference/` e regista-os no `manifest.json` para que a extensão DocFlow os utilize automaticamente durante a geração de documentos.

## O que fazer

### 1. Listar os ficheiros de referência

```bash
find docs/reference -maxdepth 1 \( -name "*.docx" -o -name "*.xlsx" -o -name "*.txt" -o -name "*.csv" \) | sort
```

Se não houver ficheiros (além do `style-guide.md`), informa o utilizador e termina.

### 2. Verificar o conteúdo de cada ficheiro

Para confirmar que cada ficheiro tem conteúdo extraível, testa a extração:

**DOCX:**
```bash
textutil -convert txt -stdout "docs/reference/FICHEIRO.docx" 2>/dev/null | head -20
```
Fallback Python:
```bash
python3 -c "
import zipfile, re, sys
try:
    z = zipfile.ZipFile('docs/reference/FICHEIRO.docx')
    xml = z.read('word/document.xml').decode('utf-8')
    text = re.sub(r'</w:p>', '\n', xml)
    text = re.sub(r'<[^>]+>', '', text)
    print(text[:500].strip())
except Exception as e:
    print(f'ERRO: {e}', file=sys.stderr)
"
```

**XLSX:**
```bash
python3 -c "
import zipfile, re
z = zipfile.ZipFile('docs/reference/FICHEIRO.xlsx')
if 'xl/sharedStrings.xml' in z.namelist():
    xml = z.read('xl/sharedStrings.xml').decode('utf-8')
    ss = [re.sub(r'<[^>]+>', '', m).strip() for m in re.findall(r'<si>[\s\S]*?</si>', xml)]
    print('\n'.join(ss[:20]))
"
```

### 3. Atualizar o `manifest.json`

Lê o `manifest.json` atual e atualiza o array `resources` dentro de `web_accessible_resources` para incluir os ficheiros encontrados.

**Regras:**
- Mantém o caminho completo: `"docs/reference/FICHEIRO.docx"`
- Não duplica entradas já existentes
- Não remove entradas que já lá estão (pode haver outros recursos)
- Não inclui `style-guide.md` (gerido pelo `/update-style`)
- Preserva toda a restante estrutura do manifest

**Exemplo do resultado:**
```json
"web_accessible_resources": [
  {
    "resources": [
      "docs/reference/Manual.docx",
      "docs/reference/Campos.xlsx"
    ],
    "matches": ["<all_urls>"]
  }
]
```

### 4. Confirmar ao utilizador

Após guardar o `manifest.json`, mostra:
- Quantos ficheiros foram adicionados/já existiam
- O caminho de cada um
- **Lembra que é necessário recarregar a extensão** em `chrome://extensions` → botão "Atualizar"
- Informa que estes ficheiros serão lidos automaticamente em cada geração de documento

### Nota

Para **remover** um ficheiro de referência, basta apagar a sua entrada do array `resources` no `manifest.json` e recarregar a extensão. Não é necessário apagar o ficheiro físico.
