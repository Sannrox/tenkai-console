import type { ServerCheck } from "../api/http";
import { TENKAI_CONTRACT } from "../api/tenkai.gen";
import { Centered, Title } from "../ui/kit";

/** Shown instead of sign-in when the server is unreachable or too old. */
export const ServerStatus = ({ check }: { check: Exclude<ServerCheck, { kind: "ready" }> }) => (
  <Centered>
    <Title subtitle="Can't reach this hub" />
    <p role="alert" className="m-0 text-xs text-danger">
      {check.kind === "too-old"
        ? `This server does not serve ${TENKAI_CONTRACT}. Upgrade Tenkai or use a matching console release.`
        : `The server did not answer: ${check.reason}`}
    </p>
  </Centered>
);
