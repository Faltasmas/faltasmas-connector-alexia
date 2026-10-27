# faltasmas-connector-alexia

Conector de Faltasmas para Alexia Classroom (`web2.alexiaedu.com`). Consulta las faltas de asistencia del alumno y las devuelve a la app en el formato común de conectores (`@faltasmas/connectors`).

Las credenciales nunca salen del teléfono: la app las guarda en el dispositivo y el conector solo las usa para hablar con el host permitido en el manifiesto.

## Compilar

```sh
bun install
bun test
bun run build
```

Genera `dist/connector.js`, un único fichero autocontenido (sin `import` ni `require`) que asigna `globalThis.FaltasmasConnector` al namespace del módulo; el conector está en `FaltasmasConnector.connector` (con `.manifest` y `.fetchAbsences`). El contrato completo del cargador está en el README de `faltasmas-connectors`.

## Publicar una versión

1. Actualiza `version` en `src/manifest.ts` y `package.json`.
2. Crea y sube la etiqueta `vX.Y.Z`; el workflow `release.yml` ejecuta los tests, compila y adjunta `connector.js` a la release.
3. Descarga el asset publicado de la release y calcula su hash sobre esa descarga (no sobre el fichero local); compáralo con el de la compilación local (`sha256sum dist/connector.js`) y solo si coinciden añade la entrada al registro.
4. Genera la entrada del registro con el script del repo de contratos (lee el manifest del propio bundle) y añádela a su `registry.json`:

```sh
bun run ../faltasmas-connectors/scripts/registry-entry.ts <asset-descargado> <url-del-asset>
```

## Pendiente

- Cambiar la dependencia `file:../faltasmas-connectors` por la URL de GitHub cuando el repo de contratos esté publicado.
