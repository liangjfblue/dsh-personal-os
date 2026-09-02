import { PACKAGE_NAME, PERSONAL_OS_INVOCATIONS } from "./remote-contract.ts";

export const TYPERT = {
  package: PACKAGE_NAME,
  face: "host" as const,
  schemas: [],
  model: {
    services: [],
    events: [],
    objects: [],
  },
  invocations: PERSONAL_OS_INVOCATIONS,
};
