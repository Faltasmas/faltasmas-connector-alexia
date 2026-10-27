# faltasmas-connector-alexia

Conector de Faltasmas para Alexia Classroom (`web2.alexiaedu.com`). Consulta las faltas de asistencia del alumno y las devuelve a la app en el formato común de conectores (`@faltasmas/connectors`).

Las credenciales nunca salen del teléfono: la app las guarda en el dispositivo y el conector solo las usa para hablar con el host permitido en el manifiesto.

## Compilar

```sh
bun install
bun test
bun run build
```

Genera `dist/connector.js`, un único fichero autocontenido (sin `import` ni `require`) que expone el global `FaltasmasConnector`.

## Publicar una versión

1. Actualiza `version` en `src/manifest.ts` y `package.json`.
2. Crea y sube la etiqueta `vX.Y.Z`; el workflow `release.yml` ejecuta los tests, compila y adjunta `connector.js` a la release.
3. Genera la entrada del registro con el script del repo de contratos y añádela a su `registry.json`:

```sh
bun run ../faltasmas-connectors/scripts/registry-entry.ts dist/connector.js manifest.json <url-del-asset>
```

## Pendiente

- `src/manifest.ts`: sustituir "Centro pendiente de nombre" por el nombre real del centro (`TODO(owner)`).
- Cambiar la dependencia `file:../faltasmas-connectors` por la URL de GitHub cuando el repo de contratos esté publicado.
