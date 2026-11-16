import { test, expect } from "@playwright/test";
test.skip(
  process.env.E2E_DEMO !== "true",
  "Use only an explicitly enabled isolated fictional demo installation.",
);
const password = "StudentDemo!2026",
  baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";
async function signin(page, email) {
  await page.goto("/#login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeVisible();
}
test("assign, submit, approve, publish portfolio text and revoke public visibility", async ({
  browser,
  page,
}) => {
  const title = "Browser project " + Date.now();
  await signin(page, "student5@skillswap.test");
  await page
    .getByRole("link", { name: "Exercises & projects", exact: true })
    .click();
  await page
    .getByText("Assign a task as Student Mentor", { exact: true })
    .click();
  await page.locator("select[name=context]").selectOption({ index: 0 });
  await page.getByLabel("Title", { exact: true }).fill(title);
  await page
    .getByLabel("Instructions & expected outcome", { exact: true })
    .fill(
      "Build a readable study planner and explain the responsive layout decisions.",
    );
  await page
    .getByRole("button", { name: "Assign to my learner", exact: true })
    .click();
  await expect(page).toHaveURL(/#dashboard\/task\/\d+$/);
  const context = await browser.newContext({ baseURL }),
    learner = await context.newPage();
  await signin(learner, "student6@skillswap.test");
  await learner
    .getByRole("link", { name: "Exercises & projects", exact: true })
    .click();
  await learner
    .locator(".exchange-card")
    .filter({ hasText: title })
    .getByRole("link", { name: "Open task", exact: true })
    .click();
  await learner
    .getByLabel("Explain your work", { exact: true })
    .fill(
      "I built a fictional weekly study planner and documented the small-screen layout choices.",
    );
  await learner
    .locator("input[name=work]")
    .setInputFiles({
      name: "fictional-project.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Fictional browser-test project work sample."),
    });
  await learner
    .getByRole("button", { name: "Submit private work", exact: true })
    .click();
  await expect(learner.getByText("submitted", { exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel("Decision", { exact: true }).selectOption("approved");
  await page
    .getByLabel("Practical feedback", { exact: true })
    .fill(
      "The submitted work meets the demonstration task and explains the layout choices.",
    );
  await page
    .getByRole("button", { name: "Record feedback", exact: true })
    .click();
  await expect(
    page.getByText("approved", { exact: true }).first(),
  ).toBeVisible();
  await learner.reload();
  await learner
    .getByText("Add this approved work to my portfolio", { exact: true })
    .click();
  const from = learner.locator('form[id^="portfolio-from-"]');
  await from.getByLabel("Visibility", { exact: true }).selectOption("public");
  await expect(from.locator("input[name=share_file]")).not.toBeChecked();
  await from
    .getByRole("button", { name: "Save portfolio entry", exact: true })
    .click();
  await expect(learner).toHaveURL(/#dashboard\/portfolio$/);
  const card = learner.locator(".exchange-card").filter({ hasText: title });
  await card
    .getByRole("link", { name: "View public entry →", exact: true })
    .click();
  await expect(
    learner.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
  await expect(
    learner.getByRole("link", { name: "Download shared work", exact: true }),
  ).toHaveCount(0);
  const publicURL = learner.url();
  await learner.goto("/#dashboard/portfolio");
  const edit = learner.locator(".exchange-card").filter({ hasText: title });
  await edit.getByLabel("Visibility", { exact: true }).selectOption("private");
  await edit
    .getByRole("button", { name: "Save visibility & changes", exact: true })
    .click();
  await expect(edit.getByText("private", { exact: true })).toBeVisible();
  const anonymousContext = await browser.newContext({ baseURL }),
    anonymous = await anonymousContext.newPage();
  await anonymous.goto(publicURL);
  await expect(
    anonymous.getByText("Public portfolio entry not found.", { exact: true }),
  ).toBeVisible();
  await anonymousContext.close();
  await context.close();
});
