# Actualizaciones: contrato del producto

La CLI y el estado de cada workspace tienen ciclos de actualización distintos. Un
update del programa nunca debe migrar, borrar ni reescribir datos del workspace por
su cuenta.

## 1. Actualizar el programa

- El repositorio es la fuente de desarrollo.
- Repo público: `PortalesCode/amazon-business-cli-kdp`; comando instalado: `abck`.
- Cada versión se publica como `amazon-business-cli-kdp` en npm, con versión SemVer y un tag Git
  correspondiente.
- GitHub Actions corre pruebas en cada push a `main` y pull request.
- El usuario actualiza el ejecutable explícitamente con Bun. La CLI no se
  autoactualiza en segundo plano.
- Este camino no modifica `.amazon-business/`, `.opencode/` ni archivos del proyecto.

## 2. Instalar o sincronizar recursos del workspace

`init` crea `.amazon-business/`, las carpetas vacías `Lab/` y `sitio/`, y una
`confidencial/` protegida por su propio `.gitignore`. También instala una plantilla inicial
de `.opencode/`: `ceo-editor` como agente principal, `analista-nicho` como auditor de solo
lectura y la skill `analizar-como-experto`.

La instalación inicial solo agrega archivos ausentes. Nunca reemplaza archivos OpenCode que
ya existan. `confidencial/` queda sin datos y su contenido se ignora en Git por defecto.

El futuro sincronizador mantendrá un manifiesto de archivos que él mismo instaló, incluyendo
versión y hash. La propiedad se limita a cada archivo registrado: no se considera
dueño de toda la carpeta `.opencode/`.

### Operación normal: completar/actualizar

- Archivos que faltan se instalan.
- Un archivo instalado previamente se actualiza automáticamente solo si su
  contenido sigue coincidiendo con el hash de la versión instalada.
- Si el usuario editó ese archivo, se conserva; se informa del conflicto y se
  deja disponible la versión nueva como candidato, sin pisar su edición.
- Los archivos no registrados en el manifiesto nunca se reemplazan ni eliminan.
- Primero habrá un modo de previsualización para mostrar altas, cambios y conflictos.

### Operación explícita: reconciliar y retirar

- Requiere una opción separada y confirmación explícita; no forma parte de `init`
  ni del update normal.
- Antes de cambiar o retirar cualquier archivo administrado, genera un backup
  fechado dentro de `.amazon-business/backups/`.
- Solo puede retirar archivos que figuren en el manifiesto y cuyo contenido
  coincida con la última versión administrada. Si el usuario lo modificó, lo deja
  intacto y reporta el conflicto.
- Nunca borra directorios completos ni datos de investigación o la base SQLite.
- Debe ofrecer preview y un resumen de backup/rollback antes de ejecutar.

## Configuración y reproducibilidad

Los filtros del usuario viven en `.amazon-business/criteria.json`, que la CLI carga para E4.
Los valores iniciales son un punto de partida editable, no una norma universal. Cada
evaluación incluye el snapshot de criterios realmente aplicado.

Cada corrida guarda el snapshot de parámetros efectivos para que una actualización o edición
posterior no cambie retroactivamente el significado de resultados anteriores.

## Secuencia de implementación

1. CI de pruebas (implementado).
2. Scaffold inicial de workspace y OpenCode, con criterios E4 por workspace.
3. Contrato de manifiesto, instalación/preview de actualizaciones y manejo de conflictos.
4. Migrar conocimiento útil del laboratorio sin copiar rutas, umbrales o datos históricos
   como defaults universales.
5. Comando explícito de backup y reconciliación, con pruebas de edición/conflicto.
6. Comando `update` del CLI que delega en el gestor de paquetes, sin tocar workspaces.
