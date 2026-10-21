import { describe, expect, test } from "vitest";
import { createStartTracker, redirectedFrameTarget } from "./redirect-tracking.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";

const WARNING_PAGE = "chrome-extension://abcdefghijklmnop/blocked.html";

describe("redirectedFrameTarget", () => {
  test("sends a frame whose blocked navigation was redirected to a plain page to the warning page", () => {
    expect(
      redirectedFrameTarget(
        {
          start: "https://paypal.com:secret@evil.example/",
          committed: "https://evil.example/phish",
        },
        DEFAULT_SETTINGS,
        WARNING_PAGE,
      ),
    ).toBe("chrome-extension://abcdefghijklmnop/blocked.html#https://paypal.com:***@evil.example/");
  });

  test.each([
    {
      name: "the block rules already sent it to the warning page",
      committed:
        "chrome-extension://abcdefghijklmnop/blocked.html#https://paypal.com:***@evil.example/",
    },
    {
      name: "it committed at a blocked URL, which the content script handles",
      committed: "https://paypal.com:secret@evil.example/",
    },
    {
      name: "it was redirected to another blocked URL, which the content script handles",
      committed: "https://xn--80a6aa68c8d.com/",
    },
  ] as const)("leaves the frame when $name", ({ committed }) => {
    expect(
      redirectedFrameTarget(
        { start: "https://paypal.com:secret@evil.example/", committed },
        DEFAULT_SETTINGS,
        WARNING_PAGE,
      ),
    ).toBeNull();
  });
});

describe("redirectedFrameTarget follows the settings", () => {
  test.each([
    {
      name: "a URL with user info while that blocking is off",
      start: "https://paypal.com@evil.example/",
      settings: { ...DEFAULT_SETTINGS, blockUserinfo: false },
    },
    {
      name: "a private IP address while those are excluded",
      start: "http://192.168.0.1/",
      settings: { ...DEFAULT_SETTINGS, excludePrivateIps: true },
    },
  ] as const)("leaves $name redirected elsewhere", ({ start, settings }) => {
    expect(
      redirectedFrameTarget(
        { start, committed: "https://evil.example/phish" },
        settings,
        WARNING_PAGE,
      ),
    ).toBeNull();
  });

  test("still sends a redirected IDN host to the warning page with everything else turned off", () => {
    expect(
      redirectedFrameTarget(
        { start: "https://xn--80a6aa68c8d.com/", committed: "https://evil.example/phish" },
        { blockUserinfo: false, blockIpHosts: false, excludePrivateIps: true },
        WARNING_PAGE,
      ),
    ).toBe("chrome-extension://abcdefghijklmnop/blocked.html#https://xn--80a6aa68c8d.com/");
  });
});

const REDIRECTED = ["server_redirect"] as const;

describe("createStartTracker", () => {
  test("hands back a blocked start when the frame commits through a redirect", () => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    expect(starts.redirectedFrom({ tabId: 1, frameId: 0, transitionQualifiers: REDIRECTED })).toBe(
      "https://paypal.com@evil.example/",
    );
  });

  // A commit that no redirect led to is the navigation that started there, or one Chrome
  // reports without a start, such as a blob: URL.
  test.each([
    { name: "no qualifier", transitionQualifiers: [] },
    { name: "a client redirect", transitionQualifiers: ["client_redirect"] },
    { name: "back or forward", transitionQualifiers: ["forward_back"] },
  ] as const)("hands back nothing for a commit with $name", ({ transitionQualifiers }) => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    expect(starts.redirectedFrom({ tabId: 1, frameId: 0, transitionQualifiers })).toBeUndefined();
  });

  // Chrome can commit the frame's earlier navigation after the blocked one has started
  // (measured 2026-10-20).
  test("still hands back the start after the earlier navigation commits without a redirect", () => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://example.com/" });
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    starts.redirectedFrom({ tabId: 1, frameId: 0, transitionQualifiers: [] });
    expect(starts.redirectedFrom({ tabId: 1, frameId: 0, transitionQualifiers: REDIRECTED })).toBe(
      "https://paypal.com@evil.example/",
    );
  });

  // Two navigations that start at the same blocked URL can both land through a redirect
  // (measured 2026-10-20), so a commit does not take the start away.
  test("keeps the start after a commit, for every redirect that lands in the frame", () => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    const commit = { tabId: 1, frameId: 0, transitionQualifiers: REDIRECTED };
    expect(starts.redirectedFrom(commit)).toBe("https://paypal.com@evil.example/");
    expect(starts.redirectedFrom(commit)).toBe("https://paypal.com@evil.example/");
  });
});

describe("createStartTracker across settings, navigations and tabs", () => {
  // The settings are read when the navigation commits, so a start counts if any setting could
  // block it. The URLs of other navigations are not kept.
  test.each([
    { url: "http://192.168.0.1/", expected: "http://192.168.0.1/" },
    { url: "https://example.com/", expected: undefined },
    { url: "file://203.0.113.5/share/", expected: undefined },
  ] as const)("remembers $url only if a setting could block it", ({ url, expected }) => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url });
    expect(starts.redirectedFrom({ tabId: 1, frameId: 0, transitionQualifiers: REDIRECTED })).toBe(
      expected,
    );
  });

  test("forgets a blocked start when a new navigation in the frame starts at a plain URL", () => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    starts.started({ tabId: 1, frameId: 0, url: "https://example.com/" });
    expect(
      starts.redirectedFrom({ tabId: 1, frameId: 0, transitionQualifiers: REDIRECTED }),
    ).toBeUndefined();
  });

  test("forgets every start in a tab when the tab closes", () => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    starts.started({ tabId: 1, frameId: 3, url: "https://xn--80a6aa68c8d.com/" });
    starts.started({ tabId: 2, frameId: 0, url: "http://203.0.113.5/" });
    starts.tabClosed(1);
    const redirected = (tabId: number, frameId: number): string | undefined =>
      starts.redirectedFrom({ tabId, frameId, transitionQualifiers: REDIRECTED });
    expect(redirected(1, 0)).toBeUndefined();
    expect(redirected(1, 3)).toBeUndefined();
    expect(redirected(2, 0)).toBe("http://203.0.113.5/");
  });

  test("keeps each frame of each tab apart", () => {
    const starts = createStartTracker();
    starts.started({ tabId: 1, frameId: 0, url: "https://paypal.com@evil.example/" });
    starts.started({ tabId: 1, frameId: 3, url: "https://xn--80a6aa68c8d.com/" });
    starts.started({ tabId: 2, frameId: 0, url: "http://203.0.113.5/" });
    const redirected = (tabId: number, frameId: number): string | undefined =>
      starts.redirectedFrom({ tabId, frameId, transitionQualifiers: REDIRECTED });
    expect(redirected(1, 3)).toBe("https://xn--80a6aa68c8d.com/");
    expect(redirected(2, 0)).toBe("http://203.0.113.5/");
    expect(redirected(1, 0)).toBe("https://paypal.com@evil.example/");
  });
});
