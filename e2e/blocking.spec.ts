// Every route into an IDN host ends on the warning page; ASCII hosts are left alone.
import { expect, test } from "./support/fixtures.ts";
import { IDN_CONTENT, IDN_UNICODE_HOST } from "./support/server.ts";

test("a Unicode URL typed in goes to the warning page", async ({ extension, server }) => {
  const page = await extension.context.newPage();
  await page.goto(`http://${IDN_UNICODE_HOST}:${server.port}/login?next=/`);

  await expect(page).toHaveURL(`${extension.warningPageUrl}#${server.idnUrl("/login?next=/")}`);
  await expect(page.locator("#original-url")).toHaveText(server.idnUrl("/login?next=/"));
  expect(server.idnRequests).toEqual([]);
});

test("clicking an IDN link goes to the warning page", async ({ extension, server }) => {
  const page = await extension.context.newPage();
  await page.goto(server.asciiUrl("/link"));
  await page.locator("#idn-link").click();

  await expect(page).toHaveURL(`${extension.warningPageUrl}#${server.idnUrl("/clicked")}`);
  expect(server.idnRequests).toEqual([]);
});

test("a 302 redirect to an IDN host goes to the warning page", async ({ extension, server }) => {
  const page = await extension.context.newPage();
  await page.goto(server.asciiUrl("/redirect"));

  await expect(page).toHaveURL(`${extension.warningPageUrl}#${server.idnUrl("/redirected")}`);
  expect(server.idnRequests).toEqual([]);
});

test("an IDN iframe shows the warning page inside the frame only, without the buttons", async ({
  extension,
  server,
}) => {
  const page = await extension.context.newPage();
  await page.goto(server.asciiUrl("/iframe"));

  await expect(page.locator("#outer")).toBeVisible();
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("#original-url")).toHaveText(server.idnUrl("/framed"));
  await expect(frame.locator("#details")).toBeVisible();
  await expect(frame.locator("#actions")).toBeHidden();
  expect(server.idnRequests).toEqual([]);
});

test("a sandboxed iframe without allow-scripts never shows the IDN content", async ({
  extension,
  server,
}) => {
  const page = await extension.context.newPage();
  await page.goto(server.asciiUrl("/sandboxed-iframe"));

  await expect(page.locator("#outer")).toBeVisible();
  expect(server.idnRequests).toEqual([]);
  const frame = page.frameLocator("iframe");
  await expect(frame.locator("body")).not.toContainText(IDN_CONTENT);
  // Either outcome blocks. When the redirect goes through (Chrome 156 does), blocked.js
  // cannot run in the sandbox, so the fixed bilingual text is all there is.
  const frameUrl = page
    .frames()
    .find((candidate) => candidate !== page.mainFrame())
    ?.url();
  if (frameUrl?.startsWith(extension.warningPageUrl) === true) {
    await expect(frame.locator("h1")).toContainText("PunyGuard がこのページへの移動を止めました");
    await expect(frame.locator("h1")).toContainText("PunyGuard blocked this page");
    await expect(frame.locator("#details")).toBeHidden();
    await expect(frame.locator("#actions")).toBeHidden();
  }
});

test("an ASCII host with a Japanese path is not blocked", async ({ extension, server }) => {
  const page = await extension.context.newPage();
  const url = server.asciiUrl(`/wiki/${encodeURIComponent("東京")}`);
  await page.goto(url);

  await expect(page).toHaveURL(url);
  await expect(page.locator("h1")).toHaveText("ASCII PAGE");
});

test("xn-- in the path or query of an ASCII host is not blocked", async ({ extension, server }) => {
  const page = await extension.context.newPage();
  const url = server.asciiUrl("/xn--80a6aa68c8d?next=http://xn--80a6aa68c8d.com/");
  await page.goto(url);

  await expect(page).toHaveURL(url);
  await expect(page.locator("h1")).toHaveText("ASCII PAGE");
});
