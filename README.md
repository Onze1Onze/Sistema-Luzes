# Sistema de Cartas — Owlbear Rodeo

Extensão de bandeja digital de cartas para sessões de RPG.

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

```bash
npm install
npm run dev
```

Adicione `http://localhost:5173/manifest.json` como extensão no Owlbear Rodeo e habilite-a na sala.

## Build

```bash
npm run build
npm run preview
```

## Publicação

Hospede o diretório `dist` em HTTPS e aponte a extensão do Owlbear Rodeo para o `manifest.json` hospedado. O manifest usa caminhos relativos, então o pacote pode ser servido como uma unidade.

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
