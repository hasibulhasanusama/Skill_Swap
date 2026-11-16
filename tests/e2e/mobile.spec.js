import { test, expect } from "@playwright/test";
test.skip(
  process.env.E2E_DEMO !== "true",
  "Run against an isolated fictional demo only.",
);
test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});
test("mobile public pages fit the viewport and expose usable navigation", async ({
  page,
}) => {
  for (const route of [
    "/#home",
    "/#explore",
    "/#exchange",
    "/#help",
    "/#login",
  ]) {
    await page.goto(route);
    await expect(page.locator("#app")).not.toBeEmpty();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
});
