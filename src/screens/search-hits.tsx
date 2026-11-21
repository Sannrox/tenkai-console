import { Link } from "@tanstack/react-router";
import type { SearchHit } from "../delivery/search";
import { parseReleaseSpec } from "./objects";

const linkClass = "block py-1.5 text-[13px] text-fg no-underline";

/** One search hit as a link to the matching object page. */
export const SearchHitLink = ({ hit, onPick }: { hit: SearchHit; onPick?: () => void }) => {
  const body = (
    <>
      <span className="font-semibold">{hit.title}</span>
      <span className="ml-2 text-xs text-muted">{hit.detail}</span>
    </>
  );
  if (hit.kind === "environment") {
    return (
      <Link
        to="/environments/$environment"
        params={{ environment: hit.title }}
        className={linkClass}
        onClick={onPick}
      >
        {body}
      </Link>
    );
  }
  if (hit.kind === "product") {
    return (
      <Link
        to="/products/$product"
        params={{ product: hit.title }}
        className={linkClass}
        onClick={onPick}
      >
        {body}
      </Link>
    );
  }
  if (hit.kind === "release") {
    const parsed = parseReleaseSpec(hit.title);
    if (parsed === undefined) {
      return <div className={linkClass}>{body}</div>;
    }
    return (
      <Link to="/releases/$product/$version" params={parsed} className={linkClass} onClick={onPick}>
        {body}
      </Link>
    );
  }
  if (hit.kind === "runner" && hit.runnerId !== undefined) {
    return (
      <Link
        to="/runners/$runnerId"
        params={{ runnerId: hit.runnerId }}
        className={linkClass}
        onClick={onPick}
      >
        {body}
      </Link>
    );
  }
  if (hit.kind === "finding" && hit.advisory !== undefined) {
    return (
      <Link
        to="/findings/$advisory"
        params={{ advisory: hit.advisory }}
        search={{
          ...(hit.release === undefined ? {} : { release: hit.release }),
          ...(hit.component === undefined ? {} : { component: hit.component }),
        }}
        className={linkClass}
        onClick={onPick}
      >
        {body}
      </Link>
    );
  }
  return (
    <Link to="/plans/$planId" params={{ planId: hit.title }} className={linkClass} onClick={onPick}>
      {body}
    </Link>
  );
};
