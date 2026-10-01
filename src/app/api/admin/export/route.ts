import { audit } from "@/lib/audit";
import { requireAdmin } from "@/lib/adminAuth";
import { exportCsv } from "@/lib/adminData";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const denied = requireAdmin(req);
  if (denied) return denied;
  const csv = await exportCsv();
  await audit("admin.exported");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="survey-responses.csv"',
      "Cache-Control": "no-store",
    },
  });
}
