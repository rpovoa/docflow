# DocFlow

> Grave ações do utilizador em qualquer página web e gere manuais profissionais com IA — em segundos.

DocFlow é uma extensão Chrome que observa o que faz numa aplicação web (cliques, preenchimento de campos, navegação) e transforma essas ações num manual de utilizador completo, gerado por Claude (Anthropic) ou GPT-4 (OpenAI).

---

## Funcionalidades

- **Gravação automática** — captura cliques, inputs, selects, submissões de formulários e navegação SPA sem configuração.
- **Screenshots por passo** — cada ação fica acompanhada de um screenshot com anotação visual do elemento clicado.
- **Narração por voz** — grave contexto adicional com o microfone enquanto navega; a transcrição é integrada no manual.
- **Notas manuais** — adicione anotações contextuais a qualquer momento durante a sessão.
- **Sidebar flutuante** — painel lateral (Shadow DOM, isolado da página) com contador de passos, pausa/retoma, undo e acesso rápido a todas as ações.
- **Multi-sessão** — combine várias sessões num único documento para processos complexos ou multi-etapa.
- **Geração com IA** — envia os metadados das ações para Claude ou GPT-4 e recebe um manual em Markdown estruturado, em Português Europeu (PT-PT).
- **Template de estilo** — carregue um documento de referência para que a IA replique o tom e formato da sua organização.
- **Documento interativo** — o resultado inclui screenshots inline, lightbox para zoom, sidebar de navegação por passos e exportação para Markdown, Word (.docx) e PDF.
- **Dashboard** — gerencie sessões, edite passos individualmente, exclua passos irrelevantes, regere ou combine documentos.
- **Chaves API encriptadas** — as chaves ficam cifradas com AES-GCM em `chrome.storage.local`; a chave de encriptação vive apenas em `chrome.storage.session` (memória).

---

## Instalação (modo de desenvolvimento)

> A extensão ainda não está publicada na Chrome Web Store. Instale-a manualmente.

### Pré-requisitos

- Google Chrome 114 ou superior
- Chave API da [Anthropic](https://console.anthropic.com/) ou da [OpenAI](https://platform.openai.com/)

### Passos

```bash
# 1. Clone o repositório
git clone https://github.com/<seu-utilizador>/docflow-extension.git
cd docflow-extension
```

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo de programador** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `docflow-extension`.
4. A extensão aparece na barra de ferramentas. Clique no ícone → **⚙ Configurações · Dashboard** → insira a sua chave API.

---

## Como usar

### Gravar uma sessão

1. Navegue até à aplicação que quer documentar.
2. Clique no ícone DocFlow na barra de ferramentas.
3. Dê um nome à sessão e clique em **Iniciar Sessão**.
4. A sidebar flutuante aparece. Navegue e interaja normalmente — cada ação é registada automaticamente.
5. Use os botões da sidebar para pausar, adicionar notas, narrar por voz ou fazer um screenshot manual.
6. Clique em **⏹ Parar Sessão** quando terminar.

### Gerar o documento

1. Após parar a sessão, o popup mostra o resumo (passos + screenshots).
2. Clique em **✨ Gerar Documento com IA**.
3. O documento abre numa nova aba com screenshots inline e sidebar de navegação.
4. Exporte para **Markdown**, **Word** ou **PDF**.

### Combinar sessões

Para processos divididos em várias sessões:

1. No popup, clique em **📚 Sessões guardadas**.
2. Selecione as sessões pretendidas (checkbox).
3. Clique em **✨ Gerar documento (N sessões)**.

---

## Estrutura do projeto

```
docflow-extension/
├── manifest.json              # Manifest V3
├── background/
│   └── service-worker.js      # Lógica central: sessões, IA, storage
├── content/
│   ├── tracker.js             # Content script: captura de ações + sidebar
│   └── tracker.css            # Flash de feedback visual
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js               # UI de início/paragem de sessão
├── dashboard/
│   ├── dashboard.html
│   ├── dashboard.css
│   └── dashboard.js           # Gestão de sessões + configurações + API keys
├── sidebar/
│   ├── result.html
│   ├── result.css
│   └── result.js              # Documento gerado + exportação
└── icons/
    └── icon{16,32,48,128}.png
```

---

## Configuração

Aceda ao Dashboard (`⚙ Configurações · Dashboard`) para:

| Opção | Descrição |
|---|---|
| **Provider** | Anthropic (Claude) ou OpenAI (GPT-4) |
| **Modelo** | `claude-opus-4-5`, `claude-sonnet-4-6`, `gpt-4o`, etc. |
| **Screenshots** | Ativar/desativar captura automática por passo |
| **Template** | Carregar documento de referência para adaptar o estilo dos manuais gerados |
| **Chave API** | Guardada cifrada; pode bloquear (apaga da sessão) ou remover a qualquer momento |

---

## Segurança e privacidade

- **As chaves API nunca saem do browser em claro.** São cifradas com AES-GCM antes de persistir em `chrome.storage.local`.
- A chave de encriptação existe apenas em `chrome.storage.session` (memória volátil, apagada ao fechar o browser).
- Os dados das sessões (passos, screenshots) ficam exclusivamente em `chrome.storage.local` — nenhum servidor externo recebe estes dados.
- As chamadas à API de IA são feitas diretamente do browser para `api.anthropic.com` / `api.openai.com` com a sua chave.

---

## Permissões utilizadas

| Permissão | Motivo |
|---|---|
| `activeTab` | Ler URL e título da tab ativa |
| `scripting` | Injetar o tracker em tabs abertas antes da instalação |
| `storage` | Persistir sessões e configurações |
| `tabs` | Capturar screenshots e enviar mensagens entre tabs |
| `unlimitedStorage` | Screenshots em base64 podem ser volumosos |
| `host_permissions: <all_urls>` | Gravar ações em qualquer site |

---

## Tecnologias

- **Chrome Extension Manifest V3** — Service Worker, Shadow DOM, chrome.scripting
- **Vanilla JS** — sem frameworks; sem dependências de build
- **Web Speech API** — narração por voz (requer Chrome)
- **Anthropic API** com prompt caching (`anthropic-beta: prompt-caching-2024-07-31`)
- **OpenAI API** — suporte alternativo
- **AES-GCM** — encriptação nativa via Web Crypto API

---

## Contribuir

1. Fork do repositório
2. Crie um branch: `git checkout -b feature/nome-da-feature`
3. Commit: `git commit -m "feat: descrição da feature"`
4. Push: `git push origin feature/nome-da-feature`
5. Abra um Pull Request

---

## Licença

MIT © 2025 DocFlow
