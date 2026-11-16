import { test, expect } from "@playwright/test";
test.skip(
  process.env.E2E_DEMO !== "true",
  "Use only an explicitly enabled isolated fictional demo installation.",
);
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000",
  password = "StudentDemo!2026";
async function signin(page, email) {
  await page.goto("/#login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
test("restricted staff navigation and student support resolution remain permission-scoped", async ({
  browser,
  page,
}) => {
  await signin(page, "verifier@skillswap.test");
  await expect(
    page.getByRole("link", { name: "Verification queue", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Payments & withdrawals", exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get("/api/admin/payments")).status()).toBe(403);
  const studentContext = await browser.newContext({ baseURL }),
    student = await studentContext.newPage();
  await signin(student, "student6@skillswap.test");
  await student
    .getByRole("link", { name: "Help & support", exact: true })
    .click();
  await student.getByText("Open a support request", { exact: true }).click();
  const subject = "Browser support " + Date.now();
  await student.getByLabel("Subject", { exact: true }).fill(subject);
  await student
    .getByLabel("Describe the issue", { exact: true })
    .fill(
      "Please explain the private project submission and feedback process.",
    );
  await student
    .getByRole("button", { name: "Submit support request", exact: true })
    .click();
  await expect(student).toHaveURL(/#dashboard\/ticket\/\d+$/);
  const supportContext = await browser.newContext({ baseURL }),
    support = await supportContext.newPage();
  await signin(support, "support@skillswap.test");
  await support
    .getByRole("link", { name: "Support requests", exact: true })
    .click();
  await support
    .locator(".exchange-card")
    .filter({ hasText: subject })
    .getByRole("link", { name: "Open request", exact: true })
    .click();
  const reply =
    "Use Exercises & projects to submit work privately and inspect your feedback history.";
  await support.getByLabel("Reply", { exact: true }).fill(reply);
  await support
    .getByRole("button", { name: "Send in-app reply", exact: true })
    .click();
  await expect(support.getByText(reply, { exact: true })).toBeVisible();
  const decision = support.locator("#support-status");
  await decision.getByLabel("Status", { exact: true }).selectOption("resolved");
  await decision
    .getByLabel("Assigned administrator", { exact: true })
    .selectOption({ label: "Fictional support administrator" });
  await decision
    .getByLabel("Recorded reason", { exact: true })
    .fill(
      "The fictional project submission question was answered in the support conversation.",
    );
  await decision
    .getByRole("button", { name: "Record support decision", exact: true })
    .click();
  await expect(
    support.getByText("resolved", { exact: true }).first(),
  ).toBeVisible();
  await student.reload();
  await expect(student.getByText(reply, { exact: true })).toBeVisible();
  await expect(student.getByText("resolved", { exact: true })).toBeVisible();
  await expect(
    student.getByRole("button", { name: "Send in-app reply", exact: true }),
  ).toHaveCount(0);
  await supportContext.close();
  await studentContext.close();
});
