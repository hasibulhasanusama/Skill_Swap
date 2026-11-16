export const permissionCatalog = [
  "overview.read",
  "users.read",
  "users.write",
  "verification.read",
  "verification.write",
  "files.verification",
  "files.dispute",
  "files.content",
  "categories.read",
  "categories.write",
  "listings.read",
  "listings.write",
  "bookings.read",
  "exchanges.read",
  "exchanges.write",
  "payments.read",
  "payments.write",
  "disputes.read",
  "disputes.write",
  "reviews.read",
  "reviews.write",
  "portfolios.read",
  "portfolios.write",
  "announcements.read",
  "announcements.write",
  "support.read",
  "support.write",
  "reports.read",
  "policies.read",
  "policies.write",
  "roles.manage",
  "audit.read",
];
export const can = (user, permission) =>
  user?.role === "admin" &&
  (user.admin_permissions?.includes("*") ||
    user.admin_permissions?.includes(permission));
export async function loadPermissions(db, user) {
  if (user?.role === "admin")
    user.admin_permissions =
      (
        await db.query("SELECT permissions FROM admin_roles WHERE key=$1", [
          user.admin_role,
        ])
      ).rows[0]?.permissions || [];
  return user;
}
export function adminPermissionFor(path, method) {
  const prefix = path.split("/").filter(Boolean)[0],
    write = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (["roles", "administrators"].includes(prefix)) return "roles.manage";
  const groups = {
    overview: "overview",
    users: "users",
    verifications: "verification",
    categories: "categories",
    listings: "listings",
    "learning-sessions": "bookings",
    exchanges: "exchanges",
    "exchange-reports": "exchanges",
    payments: "payments",
    allocations: "payments",
    withdrawals: "payments",
    "payment-disputes": "disputes",
    reviews: "reviews",
    portfolios: "portfolios",
    announcements: "announcements",
    complaints: "support",
    reports: "reports",
    policies: "policies",
    audit: "audit",
  };
  if (!groups[prefix]) return null;
  if (prefix === "exchange-reports" && write) return "support.write";
  return groups[prefix] + (write ? ".write" : ".read");
}
export async function adminFileAccess(db, user, fileId) {
  if (can(user, "*")) return true;
  const predicates = [];
  if (can(user, "files.verification"))
    predicates.push("EXISTS(SELECT 1 FROM verifications v WHERE v.file_id=$1)");
  if (can(user, "files.dispute"))
    predicates.push(
      "EXISTS(SELECT 1 FROM dispute_evidence e WHERE e.file_id=$1)",
    );
  if (can(user, "files.content"))
    predicates.push(
      "EXISTS(SELECT 1 FROM learning_materials m WHERE m.file_id=$1) OR EXISTS(SELECT 1 FROM project_submissions s WHERE s.file_id=$1) OR EXISTS(SELECT 1 FROM portfolio_entries p WHERE p.file_id=$1)",
    );
  if (!predicates.length) return false;
  return (
    (
      await db.query(
        "SELECT 1 AS allowed WHERE " +
          predicates.map((p) => "(" + p + ")").join(" OR "),
        [fileId],
      )
    ).rows.length > 0
  );
}
