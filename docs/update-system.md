# Actualizaciones: contrato del producto

La CLI y el estado de cada workspace tienen ciclos de actualización distintos. Un
update del programa nunca debe migrar, borrar ni reescribir datos del workspace por
su cuenta.

## 1. Actualizar el programa

- El repositorio es la fuente de desarrollo.
- Cada versión se publica como paquete npm con versión SemVer y un tag Git
  correspondiente.
- GitHub Actions corre pruebas en cada push a `main` y pull request. Un release
  publicará el paquete solo cuando el nombre del paquete y el registry estén
  definidos.
- El usuario actualiza el ejecutable explícitamente con Bun. La CLI no se
  autoactualiza en segundo plano.
- Este camino no modifica `.amazon-business/`, `.opencode/` ni archivos del proyecto.

## 2. Instalar o sincronizar recursos del workspace

`init` instalará agentes y skills empaquetados en `.opencode/`, además de crear
el estado local en `.amazon-business/`.

El instalador mantendrá un manifiesto de archivos que él mismo instaló, incluyendo
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

Los defaults empaquetados no se editan en el proyecto. Los filtros y decisiones
del usuario viven en configuración propia del workspace. Cada corrida registra una
copia/version de los parámetros efectivos para que una actualización no cambie
retroactivamente el significado de resultados anteriores.

## Secuencia de implementación

1. CI de pruebas (implementado).
2. Contrato de manifest, instalación y preview de recursos de workspace.
3. Migración revisada de los agentes/skills que hoy viven en el laboratorio.
4. Comando explícito de backup y reconciliación, con pruebas de edición/conflicto.
5. Elegir nombre de paquete/registry y publicar versiones desde tags.
6. Comando `update` del CLI que delega en el gestor de paquetes, sin tocar workspaces.
