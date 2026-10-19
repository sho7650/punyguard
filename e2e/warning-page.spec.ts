// What the warning page shows and what its buttons do. The fragment is untrusted input.
import { expect, test } from "./support/fixtures.ts";
import { IDN_HOST, IDN_UNICODE_HOST } from "./support/server.ts";

test("shows the original URL, both forms of the host and each non-ASCII character", async ({
  extension,
  server,
}) => {
  const page = await extension.context.newPage();
  await page.goto(server.idnUrl("/login?next=/"));

  await expect(page.locator("#original-url")).toHaveText(server.idnUrl("/login?next=/"));
  // The original URL is plain text, never a link.
  await expect(page.locator("#details a")).toHaveCount(0);
  await expect(page.locator("#unicode-host")).toHaveText(IDN_UNICODE_HOST);
  await expect(page.locator("#punycode-host")).toHaveText(IDN_HOST);
  // а р р ӏ ө: every letter is Cyrillic; ө (U+04E9) is the one Chrome 154 missed
  const rows = page.locator("#characters tr");
  await expect(rows).toHaveCount(5);
  await expect(rows.nth(4).locator("td")).toHaveText(["ө", /Cyrillic|キリル文字/u, "U+04E9"]);
});

// The address bar shows the warning page's own URL, so the password must be masked there too.
test("masks a password in the original URL, on the page and in the address bar", async ({
  extension,
  server,
}) => {
  const page = await extension.context.newPage();
  await page.goto(server.idnUrl("/login").replace("://", "://user:secret@"));

  const masked = server.idnUrl("/login").replace("://", "://user:***@");
  await expect(page.locator("#original-url")).toHaveText(masked);
  expect(page.url()).toBe(`${extension.warningPageUrl}#${masked}`);
});

// The block rules mask the password on the way, but any page can open the warning page with a
// password in the fragment.
test("masks a password in a fragment the warning page was opened with", async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.goto(`${extension.warningPageUrl}#https://user:secret@example.com/`);

  await expect(page.locator("#original-url")).toHaveText("https://user:***@example.com/");
  expect(page.url()).toBe(`${extension.warningPageUrl}#https://user:***@example.com/`);
});

// Chrome cuts location.hash at the first ":~:" (a fragment directive).
for (const path of ["/a:~:b", "/page#:~:text=hello", "/page?q=1#frag:~:text=x"]) {
  test(`keeps ":~:" in the original URL (${path})`, async ({ extension, server }) => {
    const page = await extension.context.newPage();
    await page.goto(server.idnUrl(path));

    await expect(page.locator("#original-url")).toHaveText(server.idnUrl(path));
  });
}

test("a fragment that is not an http(s) URL shows the generic text only", async ({ extension }) => {
  const page = await extension.context.newPage();
  await page.goto(`${extension.warningPageUrl}#javascript:alert(1)`);

  await expect(page.locator("#unreadable")).toBeVisible();
  await expect(page.locator("#details")).toBeHidden();
});

// URL serialization percent-encodes "<" and no host can hold one, so markup never arrives
// raw. Entities do ("&" is allowed), which tells textContent apart from innerHTML.
test("markup in the fragment is shown as text, not parsed as HTML", async ({ extension }) => {
  const page = await extension.context.newPage();
  const markup = `<img src=x onerror="document.title='pwned'">&lt;b&gt;`;
  await page.goto(`${extension.warningPageUrl}#http://${IDN_HOST}/${markup}`);

  await expect(page.locator("#original-url")).toHaveText(
    `http://${IDN_HOST}/%3Cimg%20src=x%20onerror=%22document.title='pwned'%22%3E&lt;b&gt;`,
  );
  await expect(page.locator("img, b")).toHaveCount(0);
  await expect(page).not.toHaveTitle("pwned");
});

test("from a link, Go back returns to the previous page", async ({ extension, server }) => {
  const page = await extension.context.newPage();
  await page.goto(server.asciiUrl("/link"));
  await page.locator("#idn-link").click();
  await expect(page.locator("#go-back")).toBeVisible();

  await page.locator("#go-back").click();

  await expect(page).toHaveURL(server.asciiUrl("/link"));
});

test("as the first page of a new tab, there is no Go back", async ({ extension, server }) => {
  const opener = await extension.context.newPage();
  await opener.goto(server.asciiUrl("/new-tab-link"));
  const [page] = await Promise.all([
    extension.context.waitForEvent("page"),
    opener.locator("#idn-link").click(),
  ]);
  await expect(page).toHaveURL(`${extension.warningPageUrl}#${server.idnUrl("/new-tab")}`);

  await expect(page.locator("#close-tab")).toBeVisible();
  await expect(page.locator("#go-back")).toBeHidden();
});

for (const from of ["a link", "a new tab"] as const) {
  test(`Close this tab closes the tab (from ${from})`, async ({ extension, server }) => {
    const opener = await extension.context.newPage();
    let page = opener;
    if (from === "a link") {
      await page.goto(server.asciiUrl("/link"));
      await page.locator("#idn-link").click();
    } else {
      await opener.goto(server.asciiUrl("/new-tab-link"));
      [page] = await Promise.all([
        extension.context.waitForEvent("page"),
        opener.locator("#idn-link").click(),
      ]);
    }
    await expect(page.locator("#close-tab")).toBeVisible();

    // The "close" event is the check: it times out if the tab stays open.
    await Promise.all([page.waitForEvent("close"), page.locator("#close-tab").click()]);
  });
}
