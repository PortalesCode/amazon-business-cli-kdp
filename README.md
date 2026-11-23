# Amazon Business CLI

CLI para investigar oportunidades de mercado de Amazon KDP. Cada proyecto guarda sus datos y su
base SQLite en `.amazon-business/`, de forma independiente.

El comando de terminal es `abck`; el paquete se llama `amazon-business-cli-kdp`.

La CLI y el motor son Bun/TypeScript. Requiere Bun y la dependencia `linkedom`.

## Desarrollo

Desde esta carpeta:

```bash
bun install
bun run dev --help
bun test
```

## Instalación local reversible

```bash
bun link --global
abck --help
abck doctor
```

El link apunta a esta carpeta, así que los cambios al código se reflejan al volver a ejecutar
el comando; no hace falta reinstalar después de cada edición. Si cambia el paquete/bin, repetí
`bun link --global`. Para quitar la instalación:

```bash
bun unlink --global
```

## Instalación desde npm

Cuando la versión esté publicada:

```bash
bun add --global amazon-business-cli-kdp
abck --help
```

Para ver la versión instalada:

```bash
abck --version
```

Para actualizar solo el ejecutable, sin tocar los workspaces:

```bash
bun update --global amazon-business-cli-kdp
```

## Paths

```bash
cd /path/to/project
abck init
abck doctor
```

- `abck init` usa el directorio actual. También acepta `abck init /path/to/project`.
- No se puede inicializar ni ejecutar el motor usando directamente el home del usuario.
- `init` crea `<workspace>/.amazon-business/{config.json,data/}` y una base SQLite vacía
  aislada para ese workspace. Crea también `data/amazon`, `data/autocomplete` y `data/corridas`.
- También prepara `Lab/`, `sitio/` y `confidencial/` en la raíz, e instala una `.opencode/`
  inicial con `ceo-editor`, `analista-nicho` y la skill `analizar-como-experto`.
- Los criterios E4 se guardan en `.amazon-business/criteria.json`; cada evaluación registra
  el snapshot efectivo bajo `criteria`. Se pueden cambiar por proyecto sin editar la máquina.
- Los archivos de OpenCode existentes nunca se sobrescriben. `confidencial/` trae un `.gitignore`
  local para que su contenido no se suba accidentalmente al repositorio.
- Cada workspace tiene su propia DB; **no se usa un directorio global compartido**.
- `--workspace`: raíz del proyecto donde trabaja el agente; `machine` exige que esté inicializado.
- No existe `--data-dir`: los datos pertenecen al workspace y no se pueden redirigir a una
  carpeta global por accidente.
- `--tool-dir`: integración legacy opcional de E5; no contiene la DB principal del CLI.
- `--pipeline-dir`: override excepcional para comparar con otra instalación. Por defecto
  apunta al motor dentro de esta carpeta.
- E5 está apagada por defecto. `--legacy-e5` es opt-in y usa `competitors` en `--tool-dir`,
  fuera del workspace; no usarlo en una corrida que deba quedar aislada.

`init` es idempotente: conserva la DB y los artefactos si ya existen. Rechaza una base que no
reconoce en vez de sobrescribirla. `doctor` es de solo lectura.

## Comandos iniciales

```bash
abck machine run --plan 1 --seed 1 --workspace /path/to/project
abck machine verify --phrases-file seleccionadas.json \
  --workspace /path/to/project
```

Prueba offline de E2, sin red:

```bash
abck machine phrases \
  machine/pipeline/test/fixtures/captures/parenting-relationships-marriage.json \
  --limit 4 --label smoke \
  --workspace /path/to/project
```

La CLI propaga el exit code del motor. El pipeline E1–E4 está ahora dentro de esta carpeta y
la CLI lo ejecuta como proceso hijo. La siguiente iteración puede desacoplarlo del proceso
para fijar un contrato estable de JSON/eventos que terminal y OpenChamber consuman por igual.

## Dependencias que todavía estamos aislando

- E5 todavía invoca el comando `competitors` desde `--tool-dir`, pero solo con
  `--legacy-e5`.

La DB y los artefactos ya son propios del workspace. No copié el histórico ni la herramienta
Chromium; si queremos que la CLI sea completamente autónoma, el siguiente corte es migrar el
dossier E5 y después trasladar reglas, decisiones y datos del laboratorio con trazabilidad.
