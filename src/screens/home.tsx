import { useSession } from "../auth/session";
import { attention } from "../delivery/model";
import { useDelivery } from "../delivery/use-delivery";
import { Delivery } from "./delivery";

/** Signed-in landing: the delivery matrix (decision 2B). */
export const Home = () => {
  const token = useSession((state) => state.session?.accessToken);
  const delivery = useDelivery(token);
  const needs = attention(delivery.reports).length;
  return (
    <>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="m-0 text-lg font-semibold">Delivery</h1>
        <span className="text-xs text-muted">
          {delivery.error
            ? delivery.error.message
            : delivery.loading
              ? "Loading"
              : needs === 0
                ? `${delivery.reports.length} environments, all current`
                : `${needs} need attention`}
        </span>
      </div>
      {!delivery.loading && !delivery.error && <Delivery reports={delivery.reports} />}
    </>
  );
};
