---
name: Analizar como experto
description: Investiga oportunidades KDP con evidencia trazable y criterios explícitos del proyecto
---

# Analizar como experto

Usa este flujo para investigar una oportunidad editorial. La máquina captura y transforma
datos; el agente interpreta la evidencia y el usuario conserva el control de los criterios.
Esta skill no fija umbrales universales. Los valores activos se leen de
`.amazon-business/criteria.json`; el archivo inicial solo aporta un punto de partida editable.

## Preparar el proyecto

Desde la raíz del proyecto:

```bash
abck init
abck doctor
```

Antes de una investigación nueva, revisa los criterios y filtros que el usuario haya definido
para el proyecto. Si todavía no existen o no son claros, propone un conjunto inicial como
borrador y espera la decisión del usuario antes de tratarlo como regla activa. La evaluación
devuelve `criteria` como snapshot de los valores efectivamente usados; guárdalo junto al
resultado para que futuras ediciones no alteren la interpretación histórica.

## Flujo de evidencia

1. **Definir alcance:** marketplace, categoría, idioma, formato, fecha de corte y pregunta que
   la investigación debe responder.
2. **Capturar:** usa `abck machine capture-bestsellers` para observar categorías o
   `abck machine capture-search` para una frase concreta. Advierte antes de acceder a Amazon.
3. **Generar candidatas:** usa `abck machine phrases` con capturas existentes. Revisa los
   títulos de origen; una señal léxica no basta para decidir que una frase representa un nicho.
4. **Verificar:** selecciona explícitamente las frases que merecen verificación y usa
   `abck machine verify` solo con esa selección.
5. **Evaluar:** aplica los criterios activos del proyecto, explica cada cálculo y marca datos
   faltantes. Si el motor aplica valores fijos que no coinciden con los criterios acordados,
   no presentes su veredicto como resultado válido: informa la limitación.
6. **Auditar y entregar:** pide revisión de `analista-nicho`; conserva fuentes, fecha, criterios
   usados y configuración efectiva junto con el resultado.

## Ejemplos

```bash
# Captura de categorías (hace solicitudes a Amazon)
abck machine capture-bestsellers --tree --limit 25

# Frases desde una captura local (sin solicitudes de red)
abck machine phrases ./captura.json --limit 20 --label exploracion

# Evaluación local de un fixture
abck machine apply --fixture ./fixture.json
```

Adapta los argumentos a la ayuda actual de `abck`. Los ejemplos no autorizan por sí mismos
una solicitud de red.

## Integridad

- Etiqueta cada afirmación como **observación**, **inferencia** o **hipótesis**.
- Un ranking o BSR no es un conteo directo de ventas ni de búsquedas.
- No inventes volumen, ventas, reseñas ni datos ausentes.
- Registra la configuración exacta usada; una modificación posterior de filtros no reescribe
  el significado de una corrida anterior.
- Si aparece CAPTCHA, checkpoint o señal de bloqueo, detente y reporta evidencia incompleta.
  No uses proxies, rotación de identidades ni cookies para evadirlo.
- No publiques, compres ni modifiques cuentas sin autorización explícita.
