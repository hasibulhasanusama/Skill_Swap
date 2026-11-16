import { test, expect } from "@playwright/test";
test.skip(
  process.env.E2E_DEMO !== "true",
  "Set E2E_DEMO=true only against an isolated seeded development database.",
);
const password = "StudentDemo!2026";
async function signin(page, email) {
  await page.goto("/#login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
test("register, verify, reserve, exchange messages/materials and agree on a reschedule", async ({
  browser,
  page,
}) => {
  const suffix = Date.now(),
    email = `browser${suffix}@skillswap.test`,
    name = `Browser Student ${suffix}`;
  await page.goto("/#register");
  await page.getByLabel("Full name", { exact: true }).fill(name);
  await page
    .getByLabel("College or university", { exact: true })
    .fill("Fictional Browser College");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page
    .getByLabel("Password (at least 12 characters)", { exact: true })
    .fill(password);
  await page.locator("[name=enrolled]").check();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page).toHaveURL(/#login$/);
  await signin(page, email);
  await page
    .getByRole("link", { name: "Profile & verification", exact: true })
    .click();
  await page
    .locator("input[name=document]")
    .setInputFiles({
      name: "fictional-student.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(
        "%PDF-1.4\nFictional browser-test enrolment document",
      ),
    });
  await page
    .getByRole("button", { name: "Submit student ID", exact: true })
    .click();
  await expect(page.getByText("pending", { exact: true })).toBeVisible();
  const adminContext = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    }),
    admin = await adminContext.newPage();
  await signin(admin, "admin@skillswap.test");
  await admin
    .getByRole("link", { name: "Verification queue", exact: true })
    .click();
  const row = admin.locator(".panel").filter({ hasText: email });
  await row
    .getByLabel("Reason", { exact: true })
    .fill("Fictional browser test enrolment reviewed.");
  await row
    .getByRole("button", { name: "Record decision", exact: true })
    .click();
  await expect(row.getByText("approved", { exact: true })).toBeVisible();
  await page.reload();
  await page.goto("/#skill/1");
  await page
    .getByRole("button", { name: "Reserve session", exact: true })
    .click();
  await expect(page).toHaveURL(/#checkout\/\d+$/);
  await page
    .getByRole("button", { name: "Run sandbox payment", exact: true })
    .click();
  await expect(
    page.getByText(/Payment verified · allocation held/),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Open learning room", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Session learning room", exact: true }),
  ).toBeVisible();
  const body = `Please review my responsive layout exercise ${suffix}.`;
  await page.getByLabel("Message", { exact: true }).fill(body);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator("#message-list").getByText(body, { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Material title", { exact: true })
    .fill("Browser practice notes");
  await page
    .locator("input[name=material]")
    .setInputFiles({
      name: "practice.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fictional guided exercise: use a responsive grid."),
    });
  await page
    .getByRole("button", { name: "Share private material", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Download practice.txt", exact: true }),
  ).toBeVisible();
  const mentorContext = await browser.newContext({
      baseURL: process.env.E2E_BASE_URL || "http://localhost:3000",
    }),
    mentor = await mentorContext.newPage();
  await signin(mentor, "student1@skillswap.test");
  await mentor
    .getByRole("link", { name: "Messages & materials", exact: true })
    .click();
  await mentor.locator(".room-link").filter({ hasText: name }).click();
  await expect(
    mentor.locator("#message-list").getByText(body, { exact: true }),
  ).toBeVisible();
  await mentor.getByText("Manage meeting link", { exact: true }).click();
  await mentor
    .getByLabel("HTTPS meeting URL (leave blank to remove)", { exact: true })
    .fill("https://meet.example.com/fictional-browser-session");
  await mentor
    .getByRole("button", { name: "Save meeting link", exact: true })
    .click();
  await expect(
    mentor.getByRole("link", { name: "Open external meeting ↗", exact: true }),
  ).toBeVisible();
  await page.getByText("Propose a different time", { exact: true }).click();
  await page
    .getByLabel("Reason", { exact: true })
    .fill("A fictional timetable conflict needs a new session time.");
  await page
    .getByRole("button", { name: "Send reschedule proposal", exact: true })
    .click();
  await expect(
    page.getByText("Reschedule awaiting response", { exact: true }),
  ).toBeVisible();
  await mentor
    .getByRole("button", { name: "Refresh room", exact: true })
    .click();
  await mentor
    .getByRole("button", { name: "Accept new time", exact: true })
    .click();
  await expect(
    mentor.getByText("Reschedule response recorded.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Notifications", exact: true }).click();
  await expect(
    page.getByText("Session reschedule accepted.", { exact: true }),
  ).toBeVisible();
  await adminContext.close();
  await mentorContext.close();
});
