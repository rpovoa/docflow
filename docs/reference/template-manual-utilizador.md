# **© [ENTIDADE] | [ANO]****Manual do utilizador**

Este documento corresponde ao **Manual do Utilizador** da plataforma **[NOME DA PLATAFORMA]**.

**Desenvolvido por:**

[NOME DA EQUIPA / FORNECEDOR]

**Versão: [X.Y]**

[DD de mês de AAAA]

**Financiado por:**

[ENTIDADE / PROGRAMA DE FINANCIAMENTO, se aplicável]

[Componente / eixo / medida, se aplicável]

---

## Instruções de utilização deste template

Este template deve ser utilizado como base para a criação de novos manuais de utilizador, mantendo o mesmo formato, tom de escrita e estrutura do manual de referência.

Substituir todos os campos entre **[parênteses retos]** pelo conteúdo específico da plataforma ou módulo documentado. Sempre que uma secção não seja aplicável, deve ser removida ou adaptada, evitando deixar indicações internas no documento final.

### Tom de escrita a manter

- Utilizar linguagem clara, objetiva e institucional.
- Escrever sempre do ponto de vista do utilizador.
- Explicar a finalidade antes de detalhar campos, botões ou regras.
- Evitar linguagem técnica desnecessária, exceto quando o termo aparece na própria interface.
- Usar frases como “permite ao utilizador”, “é apresentada”, “fica disponível”, “o sistema valida”, “ao selecionar”.
- Descrever comportamentos visíveis na aplicação, não detalhes internos de implementação.
- Usar negrito para nomes de botões, campos, estados, módulos, ações e elementos da interface.
- Usar listas quando existam vários campos, opções, regras ou passos.
- Identificar imagens no formato: `Figura X - [Descrição]`.

### Convenções de escrita

- Usar **utilizador** em vez de “user”.
- Usar **ecrã**, **botão**, **campo**, **lista**, **tabela**, **separador**, **painel lateral**, **mensagem**, **validação**.
- Usar **submeter**, **guardar**, **cancelar**, **pesquisar**, **limpar pesquisa**, **ver detalhes**, **exportar lista**.
- Usar setas ou aspas para caminhos de navegação: **[Módulo] » [Ação] » [Opção]**.
- Usar datas no formato **dd-mm-aaaa**, salvo indicação contrária da aplicação.
- Evitar promessas vagas como “é fácil”, “é intuitivo” ou “rapidamente” quando não acrescentam informação operacional.

### Estrutura recomendada

O manual deve seguir a seguinte ordem:

1. Capa e identificação do documento
2. Índice, se aplicável
3. Introdução
4. Acesso à aplicação
5. Navegação geral
6. Dashboard ou página inicial
7. Módulos funcionais
8. Tipos de processo, pedido ou operação
9. Gestão documental, se aplicável
10. Gestão de acessos e permissões, se aplicável
11. Administração ou parametrização, se aplicável
12. Consulta de logs ou auditoria, se aplicável
13. Histórico de versões

---

# Introdução

## Objetivo do manual

O presente manual tem como objetivo apoiar todos os utilizadores na utilização da **[NOME DA PLATAFORMA]**, apresentando de forma clara, estruturada e objetiva as funcionalidades disponíveis.

O manual permite que o utilizador consiga:

- navegar no sistema;
- compreender a organização dos módulos;
- executar cada ação de forma correta;
- conhecer os fluxos principais;
- identificar mensagens, validações e comportamentos apresentados pelo sistema.

O foco é garantir uma experiência **coerente e fluida**, permitindo que qualquer utilizador execute as suas tarefas com segurança e autonomia.

## Público-alvo

Este documento é dirigido a **todos os utilizadores com permissões de acesso** à **[NOME DA PLATAFORMA]**, nomeadamente:

- [Perfil / grupo de utilizadores 1];
- [Perfil / grupo de utilizadores 2];
- [Perfil / grupo de utilizadores 3];
- [Perfis administrativos ou de supervisão, se aplicável].

O conteúdo encontra-se organizado para servir tanto utilizadores ocasionais como utilizadores avançados.

## Âmbito do manual

O manual abrange **todas as funcionalidades visíveis ao utilizador** dentro da plataforma, incluindo:

- acesso e autenticação;
- navegação;
- dashboard ou página inicial;
- [módulo funcional 1];
- [módulo funcional 2];
- [administração / gestão de acessos / consulta de logs, se aplicável];
- mensagens e erros comuns.

Não são incluídos:

- aspetos técnicos de infraestrutura;
- detalhes de integrações internas;
- lógica não visível ao utilizador;
- documentação de desenvolvimento ou configuração técnica.

## Documentação de apoio

Além do presente manual, poderá existir documentação complementar que suporta a utilização da plataforma.

O documento **[NOME DO DOCUMENTO DE APOIO]** contém [descrição breve do conteúdo do documento], incluindo [listas de valores / regras / anexos / parametrizações / referências].

Este documento deve ser utilizado como referência para consulta de informação complementar necessária à utilização correta da plataforma.

## Sobre a [NOME DA PLATAFORMA]

A **[NOME DA PLATAFORMA]** é a plataforma destinada a **[descrever a finalidade principal da solução]**. Centraliza, num único sistema, a tramitação e acompanhamento de:

- [processo / pedido / funcionalidade 1];
- [processo / pedido / funcionalidade 2];
- [processo / pedido / funcionalidade 3].

A plataforma foi concebida para modernizar e uniformizar procedimentos, garantindo maior rigor, eficiência e controlo nos processos. Assenta nos seguintes princípios fundamentais:

- **Segurança** - protege os dados e assegura que apenas utilizadores autorizados acedem à informação e executam ações no sistema.
- **Normalização de procedimentos** - estabelece regras e fluxos uniformes para a submissão, análise e decisão dos processos.
- **Rastreabilidade** - permite acompanhar o histórico completo de cada processo, desde a criação até à conclusão.
- **Transparência** - proporciona visibilidade sobre o estado e a tramitação dos processos, de acordo com as permissões do utilizador.
- **Modernização Digital** - digitaliza e otimiza processos, reduzindo etapas manuais, erros operacionais e dispersão de informação.

# Acesso à [NOME DA PLATAFORMA]

O acesso à **[NOME DA PLATAFORMA]** poderá ser efetuado através dos seguintes endereços URL por ambiente:

- Testes (QA): [URL DE QA]
- Produção: [URL DE PRODUÇÃO]

## Ecrã de login da aplicação

Ao aceder à **[NOME DA PLATAFORMA]**, o utilizador é recebido por um ecrã de início de sessão, que disponibiliza [número] opção/opções de autenticação, através de botões distintos e claramente identificados.

Figura 1 - Login

### Autenticação através de [MÉTODO DE AUTENTICAÇÃO 1]

A autenticação através de **[MÉTODO]** é utilizada por [tipo de utilizadores ou entidades]. Ao selecionar esta opção, o utilizador é encaminhado para o processo de autenticação correspondente, onde deverá introduzir as suas credenciais.

Quando a autenticação é concluída com sucesso, o sistema redireciona o utilizador para **[Dashboard / página inicial]**.

### Autenticação através de [MÉTODO DE AUTENTICAÇÃO 2]

Em alternativa, o utilizador pode autenticar-se através de **[MÉTODO]**. Esta modalidade utiliza um botão dedicado, disponibilizado no ecrã de login.

Ao selecionar esta opção, o utilizador é encaminhado para o fluxo de autenticação próprio de **[MÉTODO]**.

## Expiração de sessão e segurança

Por motivos de segurança, a **[NOME DA PLATAFORMA]** aplica políticas de expiração automática de sessão após períodos prolongados de inatividade. Nestes casos, o utilizador deverá autenticar-se novamente através de uma das opções disponíveis.

## Problemas comuns no acesso

Durante a autenticação, podem ocorrer algumas situações frequentes:

- **Credenciais inválidas** - ocorre quando o utilizador insere credenciais incorretas no serviço de autenticação.
- **Sem acesso a funcionalidades** - o utilizador poderá aceder à plataforma, mas não visualizar determinadas áreas caso não possua perfis, entidades ou grupos associados.
- **Sessão expirada** - a sessão expirou devido a inatividade. O utilizador deve iniciar sessão novamente.
- **Seleção incorreta da entidade** - a escolha de uma entidade que não corresponde ao serviço de origem do utilizador pode impedir a finalização do login.
- **Problemas de rede ou navegador desatualizado** - ligações instáveis ou versões desatualizadas do navegador podem impedir o correto carregamento da aplicação.

## Rodapé institucional

O rodapé institucional é transversal à aplicação e apresenta ícones, ligações ou informação institucional relevante.

Figura 2 - Rodapé

Os elementos apresentados são:

- **[Elemento institucional 1]** - [URL]
- **[Elemento institucional 2]** - [URL]
- **[Elemento institucional 3]** - [URL]

Abaixo dos ícones, o rodapé poderá incluir ligações rápidas para conteúdos institucionais e documentos de referência, apresentados em janela modal ou nova página quando selecionados pelo utilizador.

Estes elementos podem incluir:

- **Sobre** - descrição institucional da plataforma, objetivos e contexto.
- **Perguntas Frequentes** - conjunto de questões e respostas sobre funcionalidades, estados, operações e procedimentos comuns.
- **Declaração de Acessibilidade e Usabilidade** - declaração oficial de acessibilidade da plataforma, quando aplicável.
- **Políticas de Privacidade** - informação sobre tratamento de dados pessoais, direitos dos titulares e medidas de segurança.
- **Termos e Condições** - regras de utilização da plataforma, obrigações dos utilizadores e disposições legais aplicáveis.

# Navegação geral

## Estrutura base da aplicação

A **[NOME DA PLATAFORMA]** apresenta uma interface simples, clara e orientada ao utilizador, organizada em três áreas funcionais principais:

- **Cabeçalho (header)** - localizado no topo da aplicação, contém a identificação do utilizador autenticado e o acesso à opção **Terminar sessão**.
- **Menu principal** - disponível [à esquerda / no topo], permite navegar entre os diferentes módulos da aplicação.
- **Área principal de conteúdo** - zona central onde são apresentados os ecrãs de cada módulo, incluindo listas, formulários, detalhes, tabelas e painéis laterais.

A navegação segue um modelo consistente: todos os módulos mantêm a mesma estrutura visual e o mesmo padrão de interações, garantindo uma experiência uniforme ao longo de toda a aplicação.

## Menu principal

O menu principal é o ponto de navegação entre módulos e está disponível em [descrever estados, se aplicável: aberto, fechado, com ícones, com texto].

Os módulos apresentados no menu são:

- [Módulo 1]
- [Módulo 2]
- [Módulo 3]
- [Módulo administrativo, se aplicável]

Quando o utilizador seleciona um módulo, o item correspondente fica visualmente realçado, permitindo saber sempre em que área da aplicação se encontra.

## Elementos comuns da interface

A aplicação utiliza um conjunto de elementos e ações comuns em todos os módulos, garantindo consistência e facilidade de utilização:

- **Breadcrumbs** - indicam o caminho de navegação até ao ecrã atual.
- **Tabelas com colunas configuráveis** - incluem funcionalidades como personalização de colunas, ordenação, paginação e exportação.
- **Áreas de pesquisa** - apresentadas no topo dos ecrãs, com pesquisa simples ou avançada, dependendo do módulo.
- **Botões principais** - incluem ações como **Pesquisar**, **Limpar**, **Criar**, **Guardar**, **Cancelar** e **Submeter**.
- **Painéis laterais** - permitem visualizar detalhes sem sair do ecrã principal.
- **Mensagens e validações** - mensagens de sucesso, aviso ou erro seguem um padrão comum e são apresentadas de forma destacada.
- **Identificação do utilizador** - apresentada no cabeçalho da aplicação.

# Dashboard

## Estrutura e finalidade do Dashboard

O **Dashboard** é a página inicial da **[NOME DA PLATAFORMA]** e disponibiliza uma visão resumida da atividade recente e do estado geral dos processos associados ao utilizador.

Cada área foi desenhada para permitir uma **navegação rápida** para os módulos principais, apresentando indicadores, listagens e atalhos operacionais que agilizam o acesso às funcionalidades mais utilizadas.

Figura 3 - Dashboard

## Cabeçalho do Dashboard

O cabeçalho do Dashboard apresenta informação contextual relevante ao utilizador, incluindo:

- **Saudação personalizada** - apresenta [nome / primeiro e último nome] do utilizador autenticado.
- **Informação de último acesso** - apresentada no formato “[texto apresentado pela aplicação]”.
- **Seleção de entidade / contexto** - caso o utilizador esteja associado a mais do que uma entidade ou contexto, é apresentada uma lista de seleção.
- **Botão “[AÇÃO PRINCIPAL]”** - disponível apenas para utilizadores com permissões adequadas.

Sempre que o utilizador altera o contexto ativo, são atualizados os indicadores, listagens e gráficos apresentados no Dashboard.

## Cards contadores

A secção principal do Dashboard apresenta cards com contadores numéricos que refletem o estado dos processos visíveis ao utilizador.

Os cards apresentados são:

- **[Estado / contador 1]**
- **[Estado / contador 2]**
- **[Estado / contador 3]**
- **Total**

Cada card apresenta:

- o número total de processos nesse estado ou conjunto de estados;
- o valor correspondente apenas aos processos que o utilizador tem permissão de visualizar;
- o comportamento de navegação ao selecionar o card.

## Card “[NOME DO CARD DE LISTAGEM]”

Este card apresenta [número] processos, ordenados por [critério de ordenação].

Para cada processo são apresentados os seguintes campos:

- **[Campo 1]**
- **[Campo 2]**
- **Estado**
- **Data de alteração**
- **Última alteração**

Interações:

- Ao selecionar **[campo clicável]**, o utilizador é redirecionado para o ecrã de detalhe do processo.
- O botão **Ver todos** redireciona para o módulo **[NOME DO MÓDULO]**, apresentando a lista completa conforme permissões.

## Card “[NOME DO CARD GRÁFICO]”

O card **[NOME DO CARD]** apresenta um gráfico que permite visualizar a distribuição dos processos por [estado / categoria / tipo], filtrada por [contexto].

Elementos disponíveis:

- **[Filtro 1]** - [descrição do filtro].
- **[Filtro 2]** - [descrição do filtro].
- **[Tipo de gráfico]** - atualizado automaticamente conforme os filtros aplicados.
- **[Totalizador, se aplicável]** - apresenta [descrição do cálculo ou agregação].

Interações:

- Ao selecionar uma área do gráfico, o utilizador é direcionado para **[módulo]** com os filtros correspondentes aplicados.
- Ao selecionar um totalizador, o comportamento é idêntico, redirecionando para a lista filtrada.

# [NOME DO MÓDULO FUNCIONAL]

## Objetivo do módulo

O módulo **[NOME DO MÓDULO]** permite [pesquisar / criar / consultar / analisar / gerir] [processos, documentos, entidades ou registos], de acordo com as permissões atribuídas ao utilizador.

O ecrã é constituído por **áreas de pesquisa, separadores de navegação, listas de resultados configuráveis e ações disponíveis por registo**.

## Pesquisa de [REGISTOS]

A área de pesquisa está organizada em dois níveis - **pesquisa simples** e **pesquisa avançada** - permitindo ao utilizador localizar registos de forma rápida ou detalhada, consoante a necessidade.

### Pesquisa simples

- **Pesquisar** - campo de texto livre que permite localizar registos através de [código, número, designação ou outro identificador].
- **[Campo adicional]** - [descrição do comportamento].

### Pesquisa avançada

- **[Critério 1]** - [tipo de campo e comportamento].
- **[Critério 2]** - [tipo de campo e comportamento].
- **Data de criação** - intervalo entre duas datas no formato dd-mm-aaaa.
- **Estado** - lista de seleção múltipla, filtrada por [critério], se aplicável.
- **Utilizador responsável** - lista de seleção, quando aplicável.

### Botões transversais da área de critérios de pesquisa

- **Pesquisar** - executa a pesquisa com base nos critérios selecionados.
- **Limpar pesquisa** - repõe todos os critérios no estado inicial.

**Nota**: A pesquisa aplica sempre as regras de visibilidade e permissões associadas ao utilizador.

## Separadores e ordenação

O módulo poderá apresentar separadores principais para organizar os registos por estado, responsabilidade ou contexto.

### [Separador 1]

- Inclui [descrição dos registos apresentados].
- **Ordenação**: lista apresentada por [campo] em ordem [crescente / decrescente].

### [Separador 2]

- Inclui [descrição dos registos apresentados].
- **Ordenação**: lista apresentada por [campo] em ordem [crescente / decrescente].

### [Separador 3]

- Inclui [descrição dos registos apresentados].
- **Ordenação**: lista apresentada por [campo] em ordem [crescente / decrescente].

## Lista de resultados, colunas, paginação e exportação

A área de lista de resultados apresenta os registos que correspondem aos critérios de pesquisa aplicados. Esta lista pode ser configurada pelo utilizador através da gestão de colunas, suporta paginação e permite a exportação com base na informação atualmente exibida no ecrã.

### Gerir colunas - comportamento e regras

A lista inclui a funcionalidade **Gerir colunas**, que permite ajustar a visibilidade das colunas apresentadas na tabela. Cada coluna segue uma das seguintes regras:

- **NA (Não Alterável)** - coluna exibida por omissão e não pode ser ocultada.
- **EX (Exibida)** - coluna exibida por omissão, podendo ser ocultada pelo utilizador.
- **IN (Inibida)** - coluna oculta por omissão, podendo ser exibida pelo utilizador.

### Colunas disponíveis

- **[Coluna 1]** ([NA/EX/IN])
- **[Coluna 2]** ([NA/EX/IN])
- **[Coluna 3]** ([NA/EX/IN])
- **[Coluna 4]** ([NA/EX/IN])

### Paginação

A tabela apresenta **paginação no rodapé**, permitindo definir o número de registos apresentados por página (**[10/20/50/100]**, se aplicável).

Quando existir seleção em massa, a checkbox de topo permite selecionar apenas os registos presentes na página atual.

### Relatório - exportar lista de resultados

- A **exportação** inclui as **colunas visíveis** e o total de registos retornados pela pesquisa no momento da exportação.
- **Nome do ficheiro:** “[NOME DO MÓDULO] - «data»_«hora».[extensão]”.

## Ações por registo

As ações disponíveis por registo dependem do estado, das permissões do utilizador e do separador selecionado.

- **[Ação 1]** - permite [descrição da ação].
- **[Ação 2]** - permite consultar o detalhe do registo.
- **[Ação 3]** - disponível apenas quando [condição de visibilidade].

## Ações em lista

As ações em lista permitem aplicar a mesma ação a vários registos em simultâneo.

**Disponibilidade** - funcionalidade disponível em [separadores / condições].

**Condições de utilização** - a ação é apresentada quando o utilizador seleciona um ou mais registos que:

- [condição 1];
- [condição 2];
- [condição 3].

**Confirmação e execução da ação**

- Ao selecionar a ação, o sistema apresenta uma janela de confirmação ou formulário complementar.
- Após confirmar, a ação é executada sobre todos os registos elegíveis.
- A lista de resultados é recarregada, refletindo as alterações aplicadas.

## Regras de visibilidade e comportamento

- A visualização dos registos respeita sempre as permissões associadas ao utilizador.
- O acesso às funcionalidades de **Criar**, **Analisar**, **Editar**, **Eliminar** ou **Exportar** depende dos perfis e grupos atribuídos.
- As ações disponíveis variam de acordo com o estado atual do registo e com o contexto de navegação.

# [TIPOS DE PROCESSO / PEDIDO / OPERAÇÃO]

## Introdução aos tipos de [PROCESSO / PEDIDO / OPERAÇÃO]

O módulo **[NOME DO MÓDULO]** disponibiliza vários tipos de [processo/pedido/operação], utilizados para [descrever finalidade geral].

Embora cada tipo tenha campos, regras e fluxos específicos, todos seguem a mesma estrutura base de formulário, ações e comportamento de análise.

Cada [processo/pedido/operação] inclui:

- **Uma finalidade clara**, que explica quando deve ser utilizado.
- **Um formulário organizado**, dividido em secções uniformes.
- **Campos de negócio específicos**, com regras de obrigatoriedade e validação próprias.
- **Ações disponíveis** que permitem criar, guardar, submeter e analisar.
- **Um fluxo de aprovação**, composto por etapas executadas pelos grupos responsáveis.
- **Operações complementares**, como a consulta de documentos associados ou da tramitação cronológica.

### Estrutura comum do formulário

Todos os tipos têm o formulário organizado nas seguintes secções:

**Informação do [processo/pedido]**

Apresenta os campos de negócio específicos do tipo e inclui dados como [entidade, valores, datas, tipos, objetivos ou âmbito]. Esta secção contém os elementos essenciais para a caracterização do registo.

**Documentos associados**

Permite ao utilizador associar documentos ao registo. A tabela apresenta, para cada ficheiro, a designação e o tipo de documento selecionado. Os documentos podem ser removidos individualmente ou todos em conjunto. Alguns tipos podem exigir documentos obrigatórios.

**Observações do [processo/pedido]**

Área dedicada ao registo escrito das decisões e justificações. Inclui, quando aplicável:

- **Fundamentação** - obrigatória em [situações aplicáveis];
- **Fundamentação anterior** - exibida em modo de leitura nas etapas de análise ou revisão;
- **Anexos** de suporte quando aplicável.

### Comportamentos transversais após submissão

Após o utilizador submeter o registo para análise:

- As secções **Informação do [processo/pedido]** e **Documentos associados** passam a estar disponíveis apenas em modo de leitura.
- A única secção editável passa a ser **Observações do [processo/pedido]**, quando aplicável.
- Quando o registo é devolvido para revisão, as secções necessárias voltam a estar editáveis.
- Após decisão final, o registo passa a estar disponível apenas em modo de leitura.

### Ações disponíveis

**Fora do formulário**

- **Analisar** - disponível quando o registo não está num estado final e o utilizador pertence ao grupo responsável pela etapa.
- **Ver detalhes** - permite consultar o detalhe do registo.

**Dentro do formulário de análise**

- **Cancelar** - regressa ao ecrã anterior sem guardar informação, mediante confirmação quando aplicável.
- **Guardar** - guarda o registo no estado atual, sem avançar no fluxo.
- **Submeter** - executa as validações obrigatórias e avança para a etapa seguinte do fluxo.

### Operações complementares

**Documentos associados** - no ecrã de detalhe, o utilizador pode visualizar, descarregar ou exportar os documentos associados. Quando não existem documentos, a tabela apresenta a indicação de ausência de documentos.

**Tramitação / histórico** - apresenta, em sequência cronológica, os registos efetuados durante o ciclo de vida do processo. Cada registo pode apresentar:

- data e hora da ação;
- estado resultante;
- grupo responsável;
- utilizador que executou a ação;
- fundamentação registada;
- anexos adicionados.

## [NOME DO TIPO 1]

### Finalidade do [processo/pedido]

O **[NOME DO TIPO 1]** é utilizado para [descrever a finalidade do tipo], assegurando que o processo segue as regras de **validação, análise e decisão** definidas para a plataforma.

### Criação do [processo/pedido]

O **[NOME DO TIPO 1]** é [criado manualmente / gerado automaticamente] por [utilizador / grupo / sistema], através da opção **[Módulo] » [Ação] » [Tipo]**.

### Formulário do [NOME DO TIPO 1]

**Informação do [processo/pedido]**

- **[Campo 1]**: [descrição do campo e comportamento].
- **[Campo 2]**: [descrição do campo e regras de obrigatoriedade].
- **[Campo 3]**: [descrição do campo, validações ou dependências].
- **Descrição**: campo de texto livre para enquadramento do pedido.

**Documentos associados**

- Permite associar ficheiros ao registo.
- A tabela apresenta a **Designação** do ficheiro e o **Tipo** de documento.
- É obrigatório associar [documento obrigatório], quando aplicável.
- Estão disponíveis as ações **Remover** e **Limpar documentos**, mediante confirmação quando aplicável.

**Observações do [processo/pedido]**

- **Fundamentação**: obrigatória em [situações].
- **Anexos**: podem ser adicionados durante as etapas de análise, quando aplicável.
- **Fundamentação anterior**: exibida em modo de leitura em [situações].

Todos os **campos obrigatórios** devem estar preenchidos antes da **submissão**.

### Fluxo do [NOME DO TIPO 1]

O fluxo é constituído por etapas sequenciais, executadas pelos utilizadores dos grupos responsáveis por cada fase.

1. **[Estado / etapa inicial]** - [Grupo responsável]

O utilizador [descrever ação].

O registo avança para o estado **[estado seguinte]**.

2. **[Etapa de análise]** - [Grupo responsável]

As decisões possíveis são:

- **[Decisão 1]** - avança para **[estado]**.
- **[Decisão 2]** - regressa para **[estado]**.
- **[Decisão 3]** - conclui o registo com o estado **[estado final]**.

Sempre que a decisão seja **[decisão]**, é enviada uma notificação aos utilizadores do grupo **[grupo]**, incluindo a fundamentação registada nesta etapa.

3. **[Etapa final]** - [Grupo responsável]

O utilizador [descrever ação final].

O registo é concluído com o estado **[estado final]**.

# Gestão de documentação

## Objetivo do módulo

O módulo **Gestão de documentação** permite pesquisar, consultar, criar, editar e gerir documentos disponibilizados na plataforma, de acordo com as permissões do utilizador.

## Pesquisa de documentos

### Pesquisa simples

- **Pesquisar** - campo de texto livre que permite localizar documentos através de [designação, código, tipo ou outro identificador].

### Pesquisa avançada

- **[Critério 1]** - [descrição].
- **[Critério 2]** - [descrição].
- **Estado** - permite filtrar documentos por estado.
- **Data** - intervalo entre duas datas no formato dd-mm-aaaa.

### Botões transversais da área de critérios de pesquisa

- **Pesquisar** - executa a pesquisa com base nos critérios selecionados.
- **Limpar pesquisa** - repõe todos os critérios no estado inicial.

### Lista de resultados

A lista de resultados apresenta os documentos que correspondem aos critérios aplicados, respeitando as permissões do utilizador.

### Gerir colunas - comportamento e regras

A funcionalidade **Gerir colunas** permite ajustar a visibilidade das colunas apresentadas na tabela.

### Colunas disponíveis

- **[Coluna 1]**
- **[Coluna 2]**
- **[Coluna 3]**

### Ações por registo

- **Ver detalhes** - permite consultar o detalhe do documento.
- **Editar** - permite alterar informação do documento, quando aplicável.
- **[Outra ação]** - [descrição].

### Paginação

A tabela apresenta paginação no rodapé, permitindo definir o número de registos apresentados por página.

### Relatório - exportar lista de resultados

A exportação inclui as colunas visíveis e os registos retornados pela pesquisa no momento da exportação.

## Novo documento

### Documento

A secção **Documento** permite preencher a informação base do documento, incluindo [campos principais].

### Caracterização do documento

A secção **Caracterização do documento** permite definir [tipo, categoria, estado, validade, âmbito ou outros atributos].

### Documentos associados

A secção **Documentos associados** permite associar ficheiros complementares ao documento principal.

### Botões do ecrã

- **Cancelar** - regressa ao ecrã anterior sem guardar alterações.
- **Guardar** - guarda a informação preenchida.
- **Submeter / Publicar / Ativar** - executa as validações obrigatórias e altera o estado do documento, quando aplicável.

## Edição de documento

A edição de documento permite alterar a informação previamente registada, respeitando as regras de estado e permissões aplicáveis.

### Botões do ecrã

- **Cancelar** - regressa ao detalhe ou lista de documentos.
- **Guardar** - guarda as alterações efetuadas.

## Detalhe de documento

O detalhe de documento apresenta a informação registada em modo de leitura.

### Documento

Apresenta os dados principais do documento.

### Caracterização do documento

Apresenta os atributos funcionais associados ao documento.

### Documentos associados

Apresenta os ficheiros associados, permitindo visualizar ou descarregar os documentos, quando aplicável.

### Botões do ecrã

- **Voltar** - regressa ao ecrã anterior.
- **Editar** - disponível quando o utilizador tem permissões para alterar o documento.

# Modelo de permissões - perfis, entidades e grupos

## Perfis de utilizador

Os perfis de utilizador determinam o conjunto de funcionalidades disponíveis na plataforma.

Os perfis existentes são:

- **[Perfil 1]** - [descrição do perfil].
- **[Perfil 2]** - [descrição do perfil].
- **[Perfil 3]** - [descrição do perfil].

## Modelo de acesso e funcionamento das permissões

O acesso à informação e às ações disponíveis depende da combinação entre:

- perfis atribuídos ao utilizador;
- entidades associadas;
- grupos de aprovação ou responsabilidade;
- estado atual do processo ou documento.

A plataforma apresenta apenas os módulos, registos e ações para os quais o utilizador possui permissões.

# Gestão de acessos

## Objetivo do módulo

O módulo **Gestão de acessos** permite administrar utilizadores, entidades, perfis e grupos associados à plataforma.

### Estrutura geral do módulo

O módulo está organizado em áreas de pesquisa, listas de resultados, formulários de criação, formulários de edição e ecrãs de detalhe.

## Pesquisa de utilizadores

### Pesquisa simples

- **Pesquisar** - campo de texto livre que permite localizar utilizadores através de [nome, email, identificador ou outro atributo].

### Botões transversais da área de critérios de pesquisa

- **Pesquisar** - executa a pesquisa.
- **Limpar pesquisa** - limpa os critérios preenchidos.

### Lista de resultados

A lista apresenta os utilizadores que correspondem aos critérios de pesquisa.

### Gerir colunas - comportamento e regras

A funcionalidade **Gerir colunas** permite ajustar a visibilidade das colunas apresentadas.

### Colunas disponíveis

- **[Coluna 1]**
- **[Coluna 2]**
- **[Coluna 3]**

### Ações por registo

- **Ver detalhes** - permite consultar o detalhe do utilizador.
- **Editar** - permite alterar dados e associações do utilizador.

### Paginação

A tabela apresenta paginação no rodapé.

### Relatório - exportar lista de resultados

A exportação inclui as colunas visíveis e os registos retornados pela pesquisa.

## Novo utilizador

### Dados do utilizador

Permite preencher os dados base do utilizador, incluindo [nome, email, identificador, estado ou outros campos].

### Perfis associados

Permite associar um ou mais perfis ao utilizador.

### Entidades associadas

Permite associar uma ou mais entidades ao utilizador.

### Grupos de aprovação

Permite associar o utilizador aos grupos responsáveis por criação, análise, validação ou decisão.

### Botões do ecrã

- **Cancelar** - regressa à lista de utilizadores.
- **Guardar** - guarda o utilizador e respetivas associações.

## Edição de utilizador

### Dados do utilizador

Permite alterar os dados base do utilizador.

### Perfis associados

Permite alterar os perfis associados.

### Entidades associadas

Permite alterar as entidades associadas.

### Grupos de aprovação

Permite alterar os grupos associados.

### Botões do ecrã

- **Cancelar** - regressa ao ecrã anterior.
- **Guardar** - guarda as alterações efetuadas.

## Detalhe de utilizador

### Dados do utilizador

Apresenta os dados base do utilizador em modo de leitura.

### Perfis associados

Apresenta os perfis atribuídos ao utilizador.

### Entidades associadas

Apresenta as entidades associadas ao utilizador.

### Grupos de aprovação

Apresenta os grupos associados ao utilizador.

### Botões do ecrã

- **Voltar** - regressa à lista de utilizadores.
- **Editar** - disponível para utilizadores com permissões de administração.

## Pesquisa de entidades

### Pesquisa simples

- **Pesquisar** - campo de texto livre que permite localizar entidades através de [código, designação ou outro identificador].

### Botões transversais da área de critérios de pesquisa

- **Pesquisar** - executa a pesquisa.
- **Limpar pesquisa** - limpa os critérios preenchidos.

### Lista de resultados

A lista apresenta as entidades que correspondem aos critérios de pesquisa.

### Gerir colunas - comportamento e regras

A funcionalidade **Gerir colunas** permite ajustar a visibilidade das colunas apresentadas.

### Colunas disponíveis

- **[Coluna 1]**
- **[Coluna 2]**
- **[Coluna 3]**

### Ações por registo

- **Ver detalhes** - permite consultar o detalhe da entidade.
- **Editar** - permite alterar dados e associações da entidade.

### Paginação

A tabela apresenta paginação no rodapé.

### Relatório - exportar lista de resultados

A exportação inclui as colunas visíveis e os registos retornados pela pesquisa.

## Nova entidade

### Dados da entidade

Permite preencher os dados base da entidade.

### Âmbitos associados

Permite associar âmbitos, áreas ou categorias à entidade, quando aplicável.

### Utilizadores associados

Permite consultar ou associar utilizadores à entidade, quando aplicável.

### Botões do ecrã

- **Cancelar** - regressa à lista de entidades.
- **Guardar** - guarda a entidade e respetivas associações.

## Edição de entidade

### Dados da entidade

Permite alterar os dados base da entidade.

### Âmbitos associados

Permite alterar os âmbitos associados.

### Utilizadores associados

Permite alterar ou consultar os utilizadores associados.

### Botões do ecrã

- **Cancelar** - regressa ao ecrã anterior.
- **Guardar** - guarda as alterações efetuadas.

## Detalhe de entidade

### Dados da entidade

Apresenta os dados base da entidade em modo de leitura.

### Âmbitos associados

Apresenta os âmbitos associados à entidade.

### Utilizadores associados

Apresenta os utilizadores associados à entidade.

### Botões do ecrã

- **Voltar** - regressa à lista de entidades.
- **Editar** - disponível para utilizadores com permissões de administração.

# Administração de [PROCESSOS / PEDIDOS / CONFIGURAÇÕES]

## Objetivo do módulo

O módulo **Administração de [PROCESSOS / PEDIDOS / CONFIGURAÇÕES]** permite configurar regras, parâmetros e comportamentos utilizados pela plataforma.

## Estrutura geral do ecrã

### Cabeçalho

O cabeçalho apresenta a identificação do módulo e informação contextual sobre a configuração em edição.

### Metadados

A área de metadados apresenta informação de apoio, como [data de criação, última alteração, utilizador responsável ou estado].

### Separadores disponíveis

O ecrã pode estar organizado nos seguintes separadores:

- **[Separador 1]** - [descrição].
- **[Separador 2]** - [descrição].
- **[Separador 3]** - [descrição].

## Configuração por [TIPO / ENTIDADE / CATEGORIA]

### Adicionar [tipo / entidade / configuração]

A opção **Adicionar [tipo]** permite incluir uma nova configuração no ecrã.

### Estrutura dos cards

Cada card apresenta a informação de configuração agrupada por [tipo, entidade ou categoria], incluindo campos editáveis e ações associadas.

## Configuração de periodicidades e datas limite

### [Processo 1] - periodicidade [mensal/trimestral/anual]

Permite configurar [dias, meses, datas limite ou regras de criação automática] aplicáveis ao processo.

### [Processo 2] - periodicidade [mensal/trimestral/anual]

Permite configurar [descrição].

## Regras transversais do módulo

### Comportamento do botão Guardar

O botão **Guardar** valida os dados preenchidos e grava as alterações efetuadas. Quando existirem erros de validação, o sistema apresenta mensagens junto dos campos correspondentes ou em área destacada.

## Lógica de criação automática de [processos/pedidos]

Quando aplicável, o sistema cria automaticamente [processos/pedidos] com base nas regras configuradas, considerando [periodicidade, entidade, tipo, data limite ou outros critérios].

# Consulta de logs

## Objetivo do módulo

O módulo **Consulta de logs** permite pesquisar e consultar registos de eventos, ações ou ocorrências geradas pela plataforma.

## Pesquisa de logs

### Pesquisa simples

- **Pesquisar** - campo de texto livre que permite localizar logs através de [mensagem, código, utilizador ou outro identificador].

### Pesquisa avançada

- **Data** - intervalo entre duas datas no formato dd-mm-aaaa.
- **Nível de severidade** - permite filtrar logs por nível.
- **Utilizador** - permite filtrar logs por utilizador.
- **Módulo** - permite filtrar logs por área funcional.

### Botões transversais da área de critérios de pesquisa

- **Pesquisar** - executa a pesquisa com base nos critérios selecionados.
- **Limpar pesquisa** - repõe todos os critérios no estado inicial.

### Lista de resultados

A lista apresenta os logs que correspondem aos critérios aplicados.

### Gerir colunas - comportamento e regras

A funcionalidade **Gerir colunas** permite ajustar a visibilidade das colunas apresentadas na tabela.

### Colunas disponíveis

- **Data/hora**
- **Nível**
- **Módulo**
- **Utilizador**
- **Mensagem**

### Ações por registo

- **Ver detalhes** - permite consultar o detalhe do log.

### Paginação

A tabela apresenta paginação no rodapé.

### Relatório - exportar lista de resultados

A exportação inclui as colunas visíveis e os registos retornados pela pesquisa.

## Detalhe do log

O detalhe do log apresenta a informação completa do evento, incluindo [data/hora, utilizador, módulo, mensagem, detalhe técnico ou funcional].

## Configurações de logs

### Cabeçalho e informação geral

Apresenta a identificação da configuração de logs e a informação geral aplicável.

### Níveis de severidade

Permite consultar ou parametrizar os níveis de severidade utilizados pela plataforma.

### Parametrizações

Permite definir comportamentos relacionados com registo, retenção ou visualização de logs, quando aplicável.

### Botões do ecrã

- **Cancelar** - regressa ao ecrã anterior.
- **Guardar** - guarda as alterações efetuadas.

# Mensagens e erros comuns

Esta secção deve reunir mensagens recorrentes apresentadas pela plataforma e orientar o utilizador sobre a ação esperada.

| Mensagem | Situação em que ocorre | Ação recomendada |
|---|---|---|
| **[Mensagem de erro ou aviso]** | [Descrição da situação] | [O que o utilizador deve fazer] |
| **[Mensagem de sucesso]** | [Descrição da situação] | [Ação seguinte, se aplicável] |

# Histórico de Versões

## Tabela de versões

| Versão | Data | Autor | Descrição |
|---|---:|---|---|
| 1.0 | [DD-MM-AAAA] | [Autor / equipa] | Versão inicial do manual. |
