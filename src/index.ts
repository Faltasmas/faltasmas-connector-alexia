import type { Connector } from "@faltasmas/connectors";
import { fetchAbsences } from "./connector";
import { manifest } from "./manifest";

export { fetchAbsences, manifest };
export const connector: Connector = { manifest, fetchAbsences };
export default connector;
