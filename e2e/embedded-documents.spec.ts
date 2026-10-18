// Documents embedded in a page with an iframe, <object> or <embed>. A blocked one shows the
// warning page inside the embedding, except a URL with user info, which Chrome refuses itself.
import { saveSettings, type Extension } from "./support/extension.ts";
import { embeddedFrame } from "./support/embedded-frame.ts";
import { expect, test } from "./support/fixtures.ts";
import {
  EMBEDDED_CONTENT,
  EMBEDDED_PATH,
  type EmbedElement,
  type TestServer,
} from "./support/server.ts";

// Chrome refuses an embedded document whose URL has user info before any request goes out, and
// PunyGuard's redirect must not be what stops it. page.goto waits for the load event, which
// waits for the embedded documents too.
async function expectUserinfoEmbedRefused(
  extension: Extension,
  server: TestServer,
  element: EmbedElement,
): Promise<void> {
  const page = await extension.context.newPage();
  await page.goto(server.embeddingUrl("userinfo", element));

  await expect(page.locator("#outer")).toBeVisible();
  expect(server.embeddedRequests).toEqual([]);
  expect(page.frames().map((frame) => frame.url())).not.toContainEqual(
    expect.stringContaining(extension.warningPageUrl),
  );
}

for (const element of ["object", "embed"] as const) {
  test(`an IDN <${element}> shows the warning page inside it only, without the buttons`, async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(server.embeddingUrl("idn", element));

    await expect(page.locator("#outer")).toBeVisible();
    const frame = await embeddedFrame(page);
    await expect(frame.locator("#original-url")).toHaveText(server.idnUrl(EMBEDDED_PATH));
    await expect(frame.locator("#reason-idnHost")).toBeVisible();
    await expect(frame.locator("#actions")).toBeHidden();
    expect(server.idnRequests).toEqual([]);
  });

  test(`an IP address <${element}> shows the warning page inside it, without the buttons`, async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(server.embeddingUrl("ip", element));

    await expect(page.locator("#outer")).toBeVisible();
    const frame = await embeddedFrame(page);
    await expect(frame.locator("#ip-address")).toHaveText("127.0.0.1");
    await expect(frame.locator("#reason-ipHost")).toBeVisible();
    await expect(frame.locator("#actions")).toBeHidden();
    expect(server.embeddedRequests).toEqual([]);
  });

  test(`a private IP address <${element}> loads while private IP addresses are excluded`, async ({
    extension,
    server,
  }) => {
    await saveSettings(
      extension,
      { blockUserinfo: true, blockIpHosts: true, excludePrivateIps: true },
      [1, 2, 3, 4, 5, 6, 7],
    );
    const page = await extension.context.newPage();
    await page.goto(server.embeddingUrl("ip", element));

    await expect((await embeddedFrame(page)).locator("h1")).toHaveText(EMBEDDED_CONTENT);
    expect(server.embeddedRequests).toEqual([EMBEDDED_PATH]);
  });

  test(`an ASCII <${element}> still loads`, async ({ extension, server }) => {
    const page = await extension.context.newPage();
    await page.goto(server.embeddingUrl("ascii", element));

    await expect((await embeddedFrame(page)).locator("h1")).toHaveText(EMBEDDED_CONTENT);
    expect(server.embeddedRequests).toEqual([EMBEDDED_PATH]);
  });
}

// Chrome refuses these by itself, so they pass without PunyGuard's rules; they are here to catch
// a change in Chrome. With user info blocking off, PunyGuard has no rule for them at all.
test.describe("embedded documents with user info", () => {
  for (const element of ["iframe", "object", "embed"] as const) {
    test(`a <${element}> is refused by Chrome, with the default settings`, async ({
      extension,
      server,
    }) => {
      await expectUserinfoEmbedRefused(extension, server, element);
    });

    test(`a <${element}> is refused by Chrome, with user info blocking off`, async ({
      extension,
      server,
    }) => {
      await saveSettings(
        extension,
        { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
        [1, 3, 8, 9],
      );
      await expectUserinfoEmbedRefused(extension, server, element);
    });
  }
});
