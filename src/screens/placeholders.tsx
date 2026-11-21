import { Link } from "@tanstack/react-router";
import { ObjectPage } from "../ui/kit";
import { APP_ITEMS } from "./nav";

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
