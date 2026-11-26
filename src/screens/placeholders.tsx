import { Link } from "@tanstack/react-router";
import { ObjectPage } from "../ui/kit";
import { objectKey, objectTypeLabel, useSaved } from "../ui/saved";
import { MORE_ITEMS } from "./nav";
import { SavedLink } from "./object-link";

/** Phone More tab: Exposure, Runners, Platform, Attention, and pins. */
export const MorePage = () => {
  const pins = useSaved((state) => state.pins);
  return (
    <ObjectPage name="More">
      <nav className="flex flex-col text-[13px] font-medium">
        {MORE_ITEMS.map((item) => (
          <Link key={item.label} to={item.to} className="py-1.5 text-fg no-underline">
            {item.label}
          </Link>
        ))}
      </nav>
      {pins.length > 0 && (
        <>
          <h2 className="mt-[18px] mb-2 text-[13px] font-semibold">Pinned</h2>
          <ul aria-label="Pinned" className="m-0 list-none p-0">
            {pins.map((item) => (
              <li key={objectKey(item)} className="mb-1 text-[13px]">
                <SavedLink item={item} />
                <span className="ml-2 text-xs text-muted">{objectTypeLabel(item.kind)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </ObjectPage>
  );
};
