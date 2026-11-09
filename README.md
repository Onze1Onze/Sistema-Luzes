# Sistema de Cartas — Owlbear Rodeo

Extensão de bandeja digital de cartas para sessões de RPG.

## Instalação no Owlbear Rodeo

Depois que o workflow de publicação terminar com sucesso, adicione este manifesto em **Profile → Extensions → Add Extension**:

`https://Onze1Onze.github.io/Sistema-Luzes/manifest.json`

O link acima é o endereço publicado para instalação. Não use o endereço do GitHub terminado em `/blob/main/manifest.json`, pois ele abre uma página HTML do GitHub, não o arquivo JSON diretamente.

Na primeira publicação, caso o GitHub Pages ainda não esteja configurado, abra **Settings → Pages** e selecione **GitHub Actions** em **Build and deployment → Source**. Depois, execute novamente o workflow **Deploy Sistema de Cartas to GitHub Pages** na aba **Actions**.

## Funcionalidades

- Bandeja horizontal com cartas individuais.
- Interface administrativa vertical.
- Criação, edição, duplicação e exclusão.
- Frente e verso por URL.
- Biblioteca de imagens do Owlbear Rodeo.
- Drag and drop para reordenação.
- Embaralhar, descartar e filtrar.
- Tamanhos pequeno, médio e grande.
- Exportação/importação de deck JSON.
- Carta revelada em destaque para todos.
- Sincronização persistente pelo metadata da sala.
- Broadcast para eventos efêmeros de revelação.
- Controle de acesso por papel GM/PLAYER.
- Respeito a reduced motion.

## Arquitetura

O estado do deck usa o namespace `com.onze1onze.sistema-cartas/deck` no metadata da sala. O Owlbear Rodeo documenta metadata de sala como armazenamento compartilhado para pequenos volumes de dados e limita o metadata total da sala a 16 KB. As imagens, portanto, não são embutidas no estado: a carta guarda apenas URLs.

A revelação usa `OBR.broadcast` para propagar o evento e também grava `revealedCardId` no estado persistente, permitindo que participantes que entrem posteriormente recebam o estado atual.

## Desenvolvimento

`npm install`

`npm run dev`

Adicione `http://localhost:5173/manifest.json` como extensão no Owlbear Rodeo.

## Build

`npm run build`

`npm run preview`

## Publicação

Cada push na branch `main` executa o workflow do GitHub Actions, compila o projeto e publica o conteúdo de `dist/` no GitHub Pages. O manifesto e o ícone são copiados da pasta `public/`; os caminhos de `icon` e `popover` no manifesto usam URLs HTTPS absolutas do site publicado.

## Imagens

Para URLs, use uma imagem com CORS apropriado. Para imagens já existentes no armazenamento do Owlbear, use **Biblioteca** no editor. O botão **Enviar** cria um asset do tipo Attachment no armazenamento do Owlbear; depois ele pode ser selecionado pela Biblioteca.

## Limite de persistência

O estado compartilhado da sala é deliberadamente compacto. O Owlbear Rodeo informa um limite de 16 KB para metadata da sala; não é seguro fingir que centenas de cartas com descrições grandes podem caber indefinidamente nesse canal. Quando o limite for excedido, a extensão recusa a gravação e informa o tamanho atual.

## Multiplayer

O Mestre controla a bandeja. Jogadores recebem a carta atualmente revelada. A atualização persistente usa room metadata e a revelação também usa o Broadcast API, que o Owlbear Rodeo documenta como canal efêmero para mensagens entre jogadores.

## APIs usadas

- `OBR.onReady`
- `OBR.room.getMetadata/setMetadata/onMetadataChange`
- `OBR.player.getRole`
- `OBR.broadcast.sendMessage/onMessage`
- `OBR.assets.downloadImages/uploadImages`

## Referências

- https://docs.owlbear.rodeo/extensions/getting-started/
- https://docs.owlbear.rodeo/extensions/apis/room/
- https://docs.owlbear.rodeo/extensions/apis/broadcast/
- https://docs.owlbear.rodeo/extensions/apis/assets/
- https://docs.owlbear.rodeo/extensions/reference/manifest/
