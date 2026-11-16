export async function loadPolicy(
  db,
  { commissionBps = 1000, completionResponseHours = 72 } = {},
) {
  const p = (await db.query("SELECT * FROM platform_policies WHERE id=1"))
    .rows[0];
  if (!p) throw new Error("Run database migrations before starting.");
  return {
    ...p,
    commission_bps: p.commission_bps ?? commissionBps,
    completion_response_hours:
      p.completion_response_hours ?? completionResponseHours,
  };
}
