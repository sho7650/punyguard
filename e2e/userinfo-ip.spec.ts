// URLs with user info and IP address hosts: what is blocked under which settings, and what the
// warning page says about it.
import type { Page } from "@playwright/test";
import { historyUrls } from "./support/browser-history.ts";
import {
  launchExtension,
  newUserDataDir,
  removeUserDataDir,
  saveSettings,
} from "./support/extension.ts";
import { expect, test } from "./support/fixtures.ts";
import { ASCII_HOST, IDN_HOST, PUBLIC_IP_URL } from "./support/server.ts";

const REASONS = ["idnHost", "userinfo", "ipHost"] as const;

// Checks that the warning page shows a section for exactly these reasons.
async function expectReasons(
  page: Page,
  shown: readonly (typeof REASONS)[number][],
): Promise<void> {
  await Promise.all(
    REASONS.map((reason) =>
      shown.includes(reason)
        ? expect(page.locator(`#reason-${reason}`)).toBeVisible()
        : expect(page.locator(`#reason-${reason}`)).toBeHidden(),
    ),
  );
}

test.describe("with the default settings", () => {
  test("a URL with user info goes to the warning page, which names the real destination", async ({
    extension,
    server,
  }) => {
    const url = server.asciiUrl("/login").replace("://", "://www.apple.com@");
    const page = await extension.context.newPage();
    await page.goto(url);

    await expect(page).toHaveURL(`${extension.warningPageUrl}#${url}`);
    await expectReasons(page, ["userinfo"]);
    await expect(page.locator("#userinfo")).toHaveText("www.apple.com");
    await expect(page.locator("#actual-host")).toHaveText(`${ASCII_HOST}:${server.port}`);
  });

  for (const { name, url, address } of [
    { name: "an IPv4 host", url: PUBLIC_IP_URL, address: "203.0.113.5" },
    { name: "an IPv6 host", url: "http://[2001:db8::1]/", address: "[2001:db8::1]" },
    { name: "a private IPv4 host", url: "http://192.168.0.1/", address: "192.168.0.1" },
  ]) {
    test(`${name} goes to the warning page`, async ({ extension }) => {
      const page = await extension.context.newPage();
      await page.goto(url);

      await expect(page).toHaveURL(`${extension.warningPageUrl}#${url}`);
      await expectReasons(page, ["ipHost"]);
      await expect(page.locator("#ip-address")).toHaveText(address);
    });
  }
});

test.describe("with the default settings, passwords", () => {
  test("a password alone is masked and still shown as user info, also after a reload", async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(server.asciiUrl("/login").replace("://", "://:secret@"));

    await expect(page).toHaveURL(
      `${extension.warningPageUrl}#${server.asciiUrl("/login").replace("://", "://:***@")}`,
    );
    await expectReasons(page, ["userinfo"]);
    await expect(page.locator("#userinfo")).toHaveText(":***");

    await page.reload();
    await expectReasons(page, ["userinfo"]);
  });

  // Chrome records the original URL without its password, but records the warning page's URL
  // as it is. Closing the browser writes the history out.
  test("the password never reaches the browser history", async ({ server }) => {
    const userDataDir = newUserDataDir();
    try {
      const extension = await launchExtension(userDataDir);
      const page = await extension.context.newPage();
      await page.goto(server.asciiUrl("/login").replace("://", "://user:secret@"));
      await expect(page.locator("#reason-userinfo")).toBeVisible();
      await extension.context.close();

      const urls = historyUrls(userDataDir);
      expect(urls).toContain(
        `${extension.warningPageUrl}#${server.asciiUrl("/login").replace("://", "://user:***@")}`,
      );
      expect(urls.filter((url) => url.includes("secret"))).toEqual([]);
    } finally {
      removeUserDataDir(userDataDir);
    }
  });
});

test.describe("with the default settings, more than one reason and iframes", () => {
  test("a URL with user info and an IP address host shows both reasons", async ({ extension }) => {
    const page = await extension.context.newPage();
    await page.goto("http://www.apple.com@203.0.113.5/");

    await expectReasons(page, ["userinfo", "ipHost"]);
    await expect(page.locator("#actual-host")).toHaveText("203.0.113.5");
  });

  test("an IP address iframe shows the warning page inside the frame", async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(server.asciiUrl("/ip-iframe"));

    await expect(page.locator("#outer")).toBeVisible();
    await expect(page.frameLocator("iframe").locator("#ip-address")).toHaveText("203.0.113.5");
  });

  test("localhost is a host name, not an IP address host, and is not blocked", async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    const url = `http://localhost:${server.port}/`;
    await page.goto(url);

    await expect(page).toHaveURL(url);
    await expect(page.locator("h1")).toHaveText("ASCII PAGE");
  });
});

// The rules match the URL as Chrome canonicalizes it; these check that form.
test.describe("canonical URLs", () => {
  test("a decimal IPv4 host becomes dotted and is blocked", async ({ extension }) => {
    const page = await extension.context.newPage();
    await page.goto("http://3232235521/");

    await expect(page).toHaveURL(`${extension.warningPageUrl}#http://192.168.0.1/`);
  });

  test("an IPv4-mapped IPv6 host becomes hex groups", async ({ extension }) => {
    // The default settings do not exclude private IP addresses, so 192.168.0.1 is blocked.
    const page = await extension.context.newPage();
    await page.goto("http://[::ffff:192.168.0.1]/");

    await expect(page).toHaveURL(`${extension.warningPageUrl}#http://[::ffff:c0a8:1]/`);
  });

  test("an @ inside the user info is percent-encoded, leaving one separator", async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(server.asciiUrl("/").replace("://", "://a@b@"));

    await expect(page).toHaveURL(
      `${extension.warningPageUrl}#${server.asciiUrl("/").replace("://", "://a%40b@")}`,
    );
  });
});

test.describe("with private IP addresses excluded", () => {
  test.beforeEach(async ({ extension }) => {
    await saveSettings(
      extension,
      { blockUserinfo: true, blockIpHosts: true, excludePrivateIps: true },
      [1, 2, 3, 4, 5, 6, 7],
    );
  });

  test("a private IPv4 host loads, and a public one is still blocked", async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    const url = `http://127.0.0.1:${server.port}/`;
    await page.goto(url);
    await expect(page).toHaveURL(url);
    await expect(page.locator("h1")).toHaveText("ASCII PAGE");

    await page.goto(PUBLIC_IP_URL);
    await expect(page).toHaveURL(`${extension.warningPageUrl}#${PUBLIC_IP_URL}`);
  });

  test("an IPv4-mapped private host is excluded too", async ({ extension, server }) => {
    const page = await extension.context.newPage();
    // 127.0.0.1 as an IPv4-mapped IPv6 address. Whether it then connects depends on the OS,
    // so only the absence of the redirect is checked.
    const response = await page.goto(`http://[::ffff:127.0.0.1]:${server.port}/`).catch(() => null);

    expect(response?.url() ?? page.url()).not.toContain(extension.warningPageUrl);
  });

  test("the unspecified address is excluded too", async ({ extension, server }) => {
    const page = await extension.context.newPage();
    // The default settings send http://[::]/ to the warning page (checked 2026-10-23). The test
    // server does not listen on IPv6, so only the absence of the redirect is checked.
    const response = await page.goto(`http://[::]:${server.port}/`).catch(() => null);

    expect(response?.url() ?? page.url()).not.toContain(extension.warningPageUrl);
  });
});

test.describe("with private IP addresses excluded, URLs with user info", () => {
  test.beforeEach(async ({ extension }) => {
    await saveSettings(
      extension,
      { blockUserinfo: true, blockIpHosts: true, excludePrivateIps: true },
      [1, 2, 3, 4, 5, 6, 7],
    );
  });

  test("a private host with user info is still blocked as a URL with user info only", async ({
    extension,
    server,
  }) => {
    const url = `http://admin@127.0.0.1:${server.port}/`;
    const page = await extension.context.newPage();
    await page.goto(url);

    await expect(page).toHaveURL(`${extension.warningPageUrl}#${url}`);
    await expectReasons(page, ["userinfo"]);
  });

  test("with user info blocking off too, a private host with user info loads", async ({
    extension,
    server,
  }) => {
    await saveSettings(
      extension,
      { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: true },
      [1, 3, 4, 5, 6, 8, 9],
    );
    const url = `http://admin@127.0.0.1:${server.port}/`;
    const page = await extension.context.newPage();
    await page.goto(url);

    await expect(page.locator("h1")).toHaveText("ASCII PAGE");
  });
});

test.describe("with user info blocking off", () => {
  test.beforeEach(async ({ extension }) => {
    await saveSettings(
      extension,
      { blockUserinfo: false, blockIpHosts: true, excludePrivateIps: false },
      [1, 3, 8, 9],
    );
  });

  test("a URL with user info loads, and xn-- in the user info is not taken for an IDN host", async ({
    extension,
    server,
  }) => {
    const page = await extension.context.newPage();
    await page.goto(server.asciiUrl("/").replace("://", "://xn--a@"));

    await expect(page.locator("h1")).toHaveText("ASCII PAGE");
  });

  test("an IDN host with user info shows the IDN reason only", async ({ extension, server }) => {
    const page = await extension.context.newPage();
    await page.goto(server.idnUrl("/").replace("://", "://user@"));

    await expectReasons(page, ["idnHost"]);
    await expect(page.locator("#punycode-host")).toHaveText(IDN_HOST);
  });
});
