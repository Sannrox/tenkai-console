import { Link } from "@tanstack/react-router";
import { ObjectPage } from "../ui/kit";
import { APP_ITEMS } from "./nav";

/** Search content lands in a later issue; the sidebar entry stays. */
export const SearchPage = () => (
  <ObjectPage name="Search">
    <p className="m-0 text-xs text-muted">
      Type to find environments, releases, runners and plans.
    </p>
  </ObjectPage>
);

/** Attention content lands in a later issue; the sidebar entry stays. */
export const AttentionPage = () => (
  <ObjectPage name="Attention">
    <p className="m-0 text-xs text-muted">Nothing needs you.</p>
  </ObjectPage>
);

/** Phone Apps tab: the same destinations the desktop sidebar lists under Apps. */
export const AppsPage = () => (
  <ObjectPage name="Apps">
    <nav className="flex flex-col text-[13px] font-medium">
      {APP_ITEMS.map((item) => (
        <Link key={item.label} to={item.to} className="py-1.5 text-fg no-underline">
          {item.label}
        </Link>
      ))}
    </nav>
  </ObjectPage>
);
