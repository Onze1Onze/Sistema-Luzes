# Sistema de Luzes — Owlbear Rodeo

Extensão de iluminação colorida e animada para mesas de RPG, com interface vertical compacta e identidade visual de arquivo tático/investigativo inspirada em Ordem Paranormal.

## Instalação no Owlbear Rodeo

Depois que o workflow **Deploy Owlbear extension to GitHub Pages** concluir com sucesso, adicione ao Owlbear este manifesto publicado:

**https://onze1onze.github.io/Sistema-Luzes/manifest.json**

Não use o endereço `raw.githubusercontent.com` para instalar a extensão. Ele entrega arquivos-fonte individuais e não serve o site compilado que o Owlbear precisa abrir no popover.

O repositório deve estar configurado em **Settings → Pages → Build and deployment → Source: GitHub Actions**. O workflow compila o projeto e publica somente a pasta `dist/`. Cada alteração enviada para `main` dispara uma nova publicação.

## Estado da implementação

Este repositório contém uma implementação inicial funcional da arquitetura de luzes. A extensão usa o SDK oficial `@owlbear-rodeo/sdk` 3.1.0 e separa a configuração compartilhada da renderização local:

- Cada luz é um `SHAPE` invisível, compartilhado na cena. Seu `metadata` namespaced guarda cor, raio, intensidade, animação, visibilidade e vínculo ao Token. Por isso, a configuração sobrevive a recarregamentos e é sincronizada pelo próprio Owlbear.
- Cada cliente reconstrói localmente um `LIGHT` oficial para interagir com o sistema Dynamic Fog e um `EFFECT` local para o filtro de cor em SkSL.
- Os efeitos de cor usam `POST_PROCESS` e consultam `scene`, seguindo o mecanismo oficial de pós-processamento do Owlbear.
- A ferramenta personalizada usa `OBR.interaction.startItemInteraction` para mover e redimensionar a forma compartilhada, aproveitando a interpolação de rede do Owlbear.
- O limite de efeitos coloridos e de fontes com suavização de sombra evita que dezenas de shaders e sombras suaves degradem toda a mesa.

## Funcionalidades presentes

- Luzes independentes com criação pelo painel ou clicando no mapa com a ferramenta da extensão.
- Seleção no painel, movimentação por arrasto, redimensionamento pela borda da área selecionada, bloqueio, duplicação e exclusão.
- Cores HEX/RGB, paleta rápida, intensidade, opacidade, raio, falloff, suavidade de sombra e temperatura visual.
- Padrões estático, piscante, pulsante, flicker, emergência, oscilante e customizado.
- Vinculação a Tokens da camada `CHARACTER`, preservando o deslocamento da fonte.
- Presets prontos e até 20 presets personalizados armazenados nos metadados do jogador.
- Visibilidade visual para todos ou apenas para o Mestre.
- Painel deliberadamente vertical, com controles empilhados. No mapa, três botões locais e exclusivos do Mestre ficam ao lado do contorno para mover, girar e redimensionar por arrasto. O Mestre move a luz pelo interior do círculo, redimensiona pela alça clara e gira pela alça âmbar; rotação e abertura do facho também ficam no painel.

## Desenvolvimento

Requisitos: Node.js 20 ou superior e npm.

1. Execute `npm install`.
2. Execute `npm run dev` para desenvolvimento.
3. Execute `npm run build` para gerar `dist/`.
4. Para uso público, publique `dist/` em um host estático HTTPS. Neste repositório, o workflow faz isso pelo GitHub Pages.

O Vite está configurado para publicar no caminho `/Sistema-Luzes/`. Os caminhos de `icon` e `popover` do manifesto são URLs HTTPS absolutas para evitar que o Owlbear resolva `index.html` ou `icon.svg` na raiz errada do domínio. O mesmo manifesto fica em `manifest.json` e `public/manifest.json`; mantenha as duas cópias sincronizadas.

## Controles

- Abra o painel **Sistema de Luzes** na interface do Owlbear.
- Como Mestre, clique em **Nova luz no centro** ou selecione a ferramenta **Sistema de Luzes** na barra e clique no mapa.
- Com a ferramenta ativa, arraste a parte interna da luz para movê-la. Com ela selecionada, arraste a borda para ajustar o raio.
- Selecione a luz pelo painel para editar os parâmetros, escolher um preset ou vincular um Token.
- Jogadores recebem a renderização correspondente, mas não recebem os controles de edição.

## Integração com névoa: limite importante

A API oficial documenta `LIGHT` como item local que interage com o sistema **Dynamic Fog**. A extensão cria esse item em `OBR.scene.local`, no padrão exigido pelo SDK. O `EFFECT` também é local e experimental, conforme a documentação oficial. Flicker, piscante, emergência e demais curvas são calculados em JavaScript com precisão dupla e atualizados localmente a 30 FPS. A velocidade e a irregularidade ajustam as curvas continuamente; o shader recebe somente a intensidade normalizada, evitando operações com timestamps Unix grandes em `float` na GPU. O brilho usa núcleo, halo radial suave e abertura direcional.

Não foi possível localizar uma API pública documentada para uma extensão chamada **Immersive Fog**. Por isso, este projeto não inventa hooks, IDs, eventos nem contratos privados dessa extensão. A integração garantida nesta versão é com a API nativa de `LIGHT`/Dynamic Fog do Owlbear. O shader pós-processado colore apenas a imagem que o próprio renderizador já entregou; ele não remove a névoa nem revela regiões que continuem ocultas. A compatibilidade específica com uma extensão de terceiros chamada Immersive Fog precisa ser validada contra o repositório/documentação exatos dessa extensão.

## Limites técnicos conhecidos

- `EFFECT` é marcado como **Experimental** pelo Owlbear. Mudanças futuras no SDK podem exigir ajustes no shader.
- Itens `LIGHT` e `EFFECT` são locais. A sincronização é feita pelas formas/configurações compartilhadas, e cada cliente reconstrói seus objetos locais ao receber mudanças da cena.
- `GM_ONLY` controla a renderização e a interface, não é uma barreira de confidencialidade: os metadados dos itens de cena são compartilhados pelo Owlbear.
- Até 64 efeitos coloridos são renderizados simultaneamente; acima disso, os mais intensos/maiores têm prioridade. Sombras suaves são limitadas a 24 fontes por cliente.
- Não existe teste automatizado de renderização do Owlbear incluído. A validação final de shaders, névoa, transformações e multiplayer deve ser feita dentro de uma sala real do Owlbear.

## Estrutura

- `src/App.tsx`: painel vertical e controles.
- `src/repository.ts`: criação, atualização, duplicação e persistência das fontes compartilhadas.
- `src/renderer.ts`: renderização local de `LIGHT`, `EFFECT` e controles de seleção.
- `src/tools.ts`: ferramenta de mapa, seleção, movimentação e redimensionamento.
- `src/presets.ts`: presets nativos.
- `src/utils.ts`: validação, cálculo de cor, vínculo e animações.
- `src/types.ts`: contratos e constantes namespaced.

## Referências técnicas

- [Owlbear Rodeo — documentação de extensões](https://docs.owlbear.rodeo/extensions/)
- [Manifest](https://docs.owlbear.rodeo/extensions/reference/manifest/)
- [Scene Items API](https://docs.owlbear.rodeo/extensions/apis/scene/items/)
- [Local Items API](https://docs.owlbear.rodeo/extensions/apis/scene/local/)
- [Interaction API](https://docs.owlbear.rodeo/extensions/apis/interaction/)
- [Tool API](https://docs.owlbear.rodeo/extensions/apis/tool/)
- [Light item](https://docs.owlbear.rodeo/extensions/reference/items/light/)
- [Effect item e SkSL](https://docs.owlbear.rodeo/extensions/reference/effects/)
- [Metadata](https://docs.owlbear.rodeo/extensions/reference/metadata/)
- [Dynamic Fog](https://extensions.owlbear.rodeo/dynamic-fog)

## Licença

MIT. A extensão é um projeto independente e não é afiliada nem endossada pelos detentores de Ordem Paranormal.
