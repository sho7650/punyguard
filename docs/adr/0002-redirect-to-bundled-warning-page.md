# 遮断時は同梱の警告ページへ転送し、そのために `<all_urls>` を要求する

遮断には DNR の `redirect` を使い、元の URL をフラグメントに入れて同梱の警告ページへ転送する。DNR の `redirect` にはホスト権限が要るので、`<all_urls>` を要求する。`block` なら要求する権限は `declarativeNetRequest` だけで済む。しかし Chrome 標準のエラー画面（`ERR_BLOCKED_BY_CLIENT`）では、ネットワークの障害なのか PunyGuard が止めたのかを区別できない。なぜ止めたかを伝えることを、権限を最小にすることより優先した。

## Consequences

- 拡張機能 ID が警告ページの URL に入るので、ルールは静的にせず、service worker が `runtime.getURL` を使って動的に登録する。
- `<all_urls>` を要求しても、content script を置かず外部と通信しない構成を保つ。理由は README に書く。
