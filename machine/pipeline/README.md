# Motor de Amazon Business CLI

Este directorio contiene el motor que ejecuta `abck`. La guía de uso está en el
[`README.md`](../../README.md) de la CLI; no ejecutar estos scripts directamente salvo para
desarrollo y tests.

El pipeline y el extractor están copiados dentro de este proyecto para poder evolucionarlos
sin depender del código de la extensión. La CLI los ejecuta con la configuración creada por
`abck init`; todos los datos y la DB quedan dentro de `.amazon-business/data/`.

```bash
bun test
abck doctor
```
