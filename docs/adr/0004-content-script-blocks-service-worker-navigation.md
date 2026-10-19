# Service Worker が応答する遷移は content script で、リダイレクトされた遷移は webNavigation で警告ページへ移す

DNR は Service Worker が応答する遷移に効かない。そのため、ユーザー情報付き URL は、攻撃者のサイトを一度開かせて Service Worker を登録させるだけで、遮断をすり抜けられた。そこで、すべてのページとその iframe に、`document_start` で動く content script を置く。この content script は `document.URL` を判定し、遮断理由に当たれば `location.replace` で警告ページへ移す。判定の時点で設定を読みに行くと、ページのスクリプトが先に動く。そのため、拡張機能の service worker が設定に合わせて content script を `scripting.registerContentScripts` で登録し直し、content script は登録の時点で設定を知っているようにする。ADR-0002 の「content script を置かない」は、この ADR で置き換える。外部と通信しないことと、ページの中身を読まないことは保つ。

Chromium 156 で、Service Worker を登録したサイトを、候補ごとに同じ条件で開いて比べた（2026-10-19。攻撃者の SW は中継型と自作型、拡張機能の service worker は動作中と停止中、各 20 回）。content script だけが、すべての条件で攻撃者のページのスクリプトを動かさなかった。その後、CDP のトレースで描画イベントを数え、content script が移す遷移では攻撃者のページが描画されないことを確かめた（各 10 回。陽性対照では毎回捉えた）。タブの履歴に残るのも、パスワードを伏せた警告ページだけだった。

Service Worker は、遷移にリダイレクトで応答することもできる。この場合、content script が見る `document.URL` はリダイレクト先になり、元の URL を知る手段はない（2026-10-19 に測定。`redirectCount`・`referrer`・`navigation.activation` のどれにも元の URL は出ない）。リダイレクト先が普通の URL なら、content script だけでは毎回すり抜けた。そこで、拡張機能の service worker が `webNavigation.onBeforeNavigate` で遮断理由に当たる遷移の開始を覚え、その遷移が遮断理由に当たらない URL で確定したと `onCommitted` で分かった時点で、`scripting.executeScript` でそのフレームに `location.replace` させ、警告ページへ移す。ページ全体の遷移と iframe で同じ仕組みを使う。最後は毎回警告ページになり、タブの履歴にも警告ページしか残らなかった。ただし、警告ページに置き換わる前に、リダイレクト先のページのスクリプトが毎回動いた。そのため、リダイレクトの場合は「最後に必ず警告ページに置き換える」ことだけを約束し、置き換わる前に表示・実行されうることは限界とする。

## Considered Options

- **`webNavigation.onBeforeNavigate` で見つけて `tabs.update` で移す（リダイレクトしない応答に対して）**: content script を置かずに済む。しかし、拡張機能の service worker が止まっていると 40 回中 40 回負け、攻撃者のページのスクリプトが 3〜8 ミリ秒先に動いた。拡張機能の service worker は、使われないとすぐに止まる。リダイレクトの場合は、`webNavigation` で元の URL を知るが、移すのは `tabs.update` ではなく `location.replace` で行う（次の項）。
- **`browsingData` でそのオリジンの Service Worker を消す**: 消した後の遷移は、既存の DNR ルールで確実に遮断される。しかし 1 回目は防げない。中継中に消すと、タブは警告ページではなく白紙のまま止まった。content script と組み合わせても、同じことが起きた。
- **content script が判定の時点で設定を読む**: manifest に書くだけで済む。しかし `chrome.storage` は非同期なので、ページ全体の遷移で 45 回中 45 回、ページのスクリプトが先に動いた。
- **リダイレクトに対して、`onBeforeNavigate` の時点で `tabs.update` を呼ぶ**: 拡張機能の service worker が動作中なら、ページ全体の遷移ではページのスクリプトは一度も動かなかった。しかし停止中は、遅れて届いた `tabs.update` が新しい履歴の項目を作り、10 回中 10 回、平文のパスワード付きの攻撃者の URL や、リダイレクト先の攻撃者のページが「戻る」に残った。DNR や content script が移した遷移でも動き、警告ページが 2 つ並んだ。
- **設定を無視して、3 つの遮断理由すべてで止める**: 仕組みは単純になる。しかし、利用者が無効にした遮断が、Service Worker が応答する遷移でだけ働くことになり、設定の意味と食い違う。

## Consequences

- `scripting` 権限と `webNavigation` 権限を要求する。`<all_urls>` があるので、インストール時の警告文は増えない（`management.getPermissionWarningsByManifest` で確認済み）。
- README の「content script を持たない」を改め、content script がすることを書く。URL を見て警告ページへ移すだけで、ページの中身は読まず、外部と通信しない。
- Service Worker 自身は、遷移に応答する時点で動く。これは防げない限界として README に書く。
- Service Worker がリダイレクトで応答した場合は、警告ページに置き換わる前に、リダイレクト先のページが表示され、動きうる。これも限界として README に書く。
- 移す先は DNR ルールと同じ `blocked.html#<元の URL>` とし、パスワードは移す前に伏せる。Service Worker が応答したページは content script が動く前に確定するが、`location.replace` が履歴の項目を置き換えるので、元の URL はタブの履歴に残らなかった。
- 攻撃者の Service Worker が iframe に効くのは、同じトップレベルのサイトの下で登録された場合だけである（ストレージのパーティション分割）。Playwright は既定で分割を無効にするので、E2E では有効にして確かめる。
- 設定を変えると、拡張機能の service worker は遮断ルールを更新してから content script の登録を更新する。その間のごく短い間は、content script が前の設定で判定する。遮断ルールの更新が非同期なのと同じ性質で、「次の遷移から効かせる」の範囲とする。E2E は、両方が新しい設定になるまで待ってから遷移する。
- `<object>` と `<embed>` の中の遷移には、Service Worker は応答しなかった。この 2 つは、引き続き DNR だけで遮断する。
