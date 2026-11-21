import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { ApiError, request } from "../api/http";
import type { EnvironmentPlanSummary } from "../api/tenkai.gen";
import { useSession } from "../auth/session";
import { planSummary } from "../delivery/model";
import { ObjectPage } from "../ui/kit";
import { ApprovalBrief } from "./approval-brief";
import { LinkedList, ProductLink } from "./object-link";
import { PlanPage } from "./plan-page";
import { TargetChanges } from "./target-changes";

const NO_ACCESS = "No access to this plan";

/** Exact plan id: environment on the query runs the environment plan; otherwise GET `/v1/plans/{id}`. */
export const PlanByIdPage = () => {
  const { planId } = useParams({ strict: false }) as { planId: string };
  const { environment } = useSearch({ strict: false }) as { environment?: string };
  const token = useSession((state) => state.session?.accessToken);
  if (environment !== undefined && token !== undefined) {
    return <PlanPage environment={environment} token={token} />;
  }
  if (token === undefined) {
    return null;
  }
  return <PlanFromId planId={planId} token={token} />;
};

const PlanFromId = ({ planId, token }: { planId: string; token: string }) => {
  const plan = useQuery({
    queryKey: ["plan", planId, token],
    queryFn: () =>
      request<EnvironmentPlanSummary>(`v1/plans/${encodeURIComponent(planId)}`, { token }),
    retry: false,
  });
  if (plan.error) {
    return (
      <ObjectPage kind="Plan" name={planId}>
        <p role="alert" className="text-xs text-danger">
          {plan.error instanceof ApiError && plan.error.status === 403
            ? NO_ACCESS
            : plan.error.message}
        </p>
      </ObjectPage>
    );
  }
  if (plan.data === undefined) {
    return (
      <ObjectPage kind="Plan" name={planId}>
        <p className="text-xs text-muted">Loading</p>
      </ObjectPage>
    );
  }
  const data = plan.data;
  return (
    <ObjectPage
      kind="Plan"
      name={planSummary(data)}
      status={data.state}
      properties={[{ label: "Plan", value: data.id }]}
      linked={
        <LinkedList
          items={[...new Set((data.steps ?? []).map((step) => step.product))].map((product) => ({
            key: product,
            node: <ProductLink product={product} />,
          }))}
        />
      }
      main={
        <>
          <ApprovalBrief plan={data} />
          <TargetChanges plan={data} token={token} />
        </>
      }
    />
  );
};
