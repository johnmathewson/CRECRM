import { redirect } from "next/navigation";

/**
 * /cre-os — Home was absorbed by Today (Oct 2026). The dashboard of KPI
 * tiles is gone; the home is the decision queue.
 */
export default function CreOsHome() {
  redirect("/cre-os/today");
}
