import type { TypertRemoteContribution } from "@deepseek-ai/dsh-typert-protocol";

import { PACKAGE_NAME, PERSONAL_OS_INVOCATIONS } from "./remote-contract.ts";

export const TYPERT_REMOTE: TypertRemoteContribution = {
  package: PACKAGE_NAME,
  descriptors: PERSONAL_OS_INVOCATIONS,
};

export default TYPERT_REMOTE;
