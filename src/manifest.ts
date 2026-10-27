import type { ConnectorManifest } from "@faltasmas/connectors";

export const manifest: ConnectorManifest = {
  id: "alexia-classroom",
  name: "Alexia Classroom",
  version: "0.1.0",
  allowedHosts: ["web2.alexiaedu.com"],
  credentialFields: [
    { key: "username", label: "Usuario", secret: false },
    { key: "password", label: "Contraseña", secret: true },
  ],
  institutions: [
    { id: "NS2IrX8Iq04%3d", name: "Centro pendiente de nombre" }, // TODO(owner): real centre name
  ],
};
