# Service Worker が応答する遷移の遮断 計画（設計確定・Phase 0 完了・実装前）

[todo-security-hardening.md](todo-security-hardening.md) の Phase 2 で、Service Worker が応答する遷移には declarativeNetRequest が効かないと分かった（[docs/decisions.md](../docs/decisions.md) の P3）。ユーザー情報付き URL は、攻撃者が自分のサイトに一度来させて Service Worker を登録させれば、PunyGuard を入れた後でもすり抜けられる。要求は [requirements-service-worker-bypass.md](requirements-service-worker-bypass.md)、設計は [ADR-0004](../docs/adr/0004-content-script-blocks-service-worker-navigation.md) に記録した。

## 決まったこと（2026-10-19）

- **成功の基準**: Service Worker が応答する遷移でも、攻撃者のページを描画させず、ページのスクリプトも動かさない。Service Worker 自身が応答する時点で動くことは、防げない限界として README に書く。Service Worker がリダイレクトで応答した場合は、最後に必ず警告ページへ置き換える（要求仕様書の FR-9・AC-4）。置き換わる前にリダイレクト先のページが表示され、動きうることは、限界として README に書く。
- **方式**（リダイレクトしない応答）: `document_start` で動く content script（全フレーム）が `document.URL` を判定し、遮断理由に当たれば `location.replace` で警告ページへ移す。`browsingData` による Service Worker の削除は行わない（中継中に消すと白紙で止まるため）。
- **リダイレクトの方式**: Service Worker がリダイレクトで応答すると、content script が見る `document.URL` はリダイレクト先になり、元の URL を知る手段がない（2026-10-19 に測定。`redirectCount`・`referrer`・`navigation.activation` のどれにも元の URL は出ない）。そこで、拡張機能の service worker が `webNavigation.onBeforeNavigate` で、遮断理由に当たる遷移の開始をタブとフレームごとに覚える。
  - `onCommitted` で、覚えた遷移が遮断理由に当たらない URL で確定したら（リダイレクトされた）、`scripting.executeScript` でそのフレームに `location.replace` させ、警告ページへ移す。ページ全体の遷移と iframe で同じ仕組みを使う。
  - 確定した URL が遮断理由に当たる場合（content script が移す）と、警告ページの場合（DNR が移した）は何もしない。
  - `location.replace` は履歴の項目を置き換えるので、タブの履歴に攻撃者のページや平文のパスワードが残らない。`onBeforeNavigate` の時点で `tabs.update` を呼ぶ方式は採らない（Phase 0 で、拡張機能の service worker が停止中だと新しい履歴の項目を作り、平文のパスワード付きの URL や攻撃者のページが「戻る」に残ったため）。
  - 判定（`findBlockReasons`）・設定・移す先（パスワードを伏せる）は、content script と同じものを使う。
  - `tabs` 権限は使わない。
- **対象**: 3 つの遮断理由すべて（IDN ホスト・ユーザー情報付き URL・IP アドレスホスト）。判定は既存の `findBlockReasons` を使う。DNR ルールと同じく、http と https の URL だけを対象にする。
- **移す先**: DNR ルールと同じ `blocked.html#<元の URL>` とし、元の URL のパスワードは移す前に `***` に伏せる（`blocked-url.ts` の `maskPassword`）。DNR ルールの `passwordRule` と同じく、警告ページのアドレスバーと履歴に平文のパスワードを残さないため。
- **ユーザー情報付き URL の iframe**: Chrome が Service Worker より先に読み込みを拒否する（2026-10-18 の調査）。今の遮断と同じく警告ページにはならないが、読み込まれず、スクリプトも動かない。content script では何もしない。
- **設定の渡し方**: content script は判定の時点で設定を読まない（`chrome.storage` は非同期で、ページのスクリプトが先に動く）。拡張機能の service worker が、登録の時点で設定を content script に渡す（下の「登録の手順」）。
- **登録の手順**:
  - 登録 ID は 1 つに固定し、`persistAcrossSessions: true`（既定値）で登録する。
  - 同じ ID で `registerContentScripts` を呼ぶと失敗する。そのため、`getRegisteredContentScripts({ ids })` で登録済みかを確かめ、登録済みなら `updateContentScripts`、未登録なら `registerContentScripts` を呼ぶ。
  - 解除してから登録し直すことはしない。解除と登録の間の遷移が無防備になるため。
  - 呼ぶ時期は、インストール時（更新・再読み込みを含む）、起動時、設定の変更時、サイトへのアクセス権の変更時。DNR ルールの登録と同じ時期。
- **登録の失敗**: DNR ルールの登録に失敗した場合と同じく、問題として `!` バッジとツールチップで知らせる。ツールチップの文言は、新しいメッセージキーで足す（英語と日本語）。
- **登録の失敗の扱い**（2026-10-19、ユーザーと決定）: 失敗は `!` バッジで知らせるだけにする。リダイレクトを追う仕組みを予備として動かすことはしない。調査では、今の作りで失敗するのは、登録の処理中に拡張機能が再読み込み・無効化された場合（一時的で、`onInstalled` で登録し直す）と、同梱ファイルが欠けた・UTF-8 でない場合（ビルドや配布の不具合）に限られた。
  - 起きないと分かったケース（同じ ID の二重登録、未登録の ID の更新、`getRegisteredContentScripts` の失敗、ID・`matches`・ファイル・大きさの不備、サイトへのアクセスやポリシーによる登録の失敗）には、実装もテストも書かず、理由を文書に残す（ユーザーの方針）。
  - 未確認: 拡張機能の更新で、動的な登録が残るか消えるか。Phase 3 の V-4 で、更新の場合も確かめる。
- **権限**: `scripting` と `webNavigation` を足す。インストール時の警告文は増えない（確認済み）。
- **E2E での Service Worker の用意**: PunyGuard を入れていないプロファイルで、先にサイトを開いて Service Worker を登録する。その後で PunyGuard を入れて起動する。テスト用ホストは `--unsafely-treat-insecure-origin-as-secure` で安全なオリジンとして扱う。
- **`<object>`・`<embed>`**: この 2 つの中の遷移には Service Worker が応答しないので、引き続き DNR だけで遮断する。

## 根拠（Chromium 156、headless で測定）

測定スクリプトと結果は scratchpad の `sw-api-research/`（`probe-all.ts`、`probe2.ts`、`probe4.ts`〜`probe6.ts`、`out-all*.txt`、`out2.txt`、`out4*.txt`〜`out7-*.txt`）に置いた。

- 候補ごとに、同じ条件で比べた。攻撃者の Service Worker は中継型と自作型の 2 種類、拡張機能の service worker は動作中と停止中の 2 通りで、それぞれ 20 回試した。content script だけが、すべての条件で、攻撃者のページのスクリプトを動かさなかった。描画（AC-1）は、この測定では見ていない（Phase 0 で確かめる）。`onBeforeNavigate` から `tabs.update` で移す方法は、拡張機能の service worker が止まっていると毎回負けた。
- content script は、3 つの遮断理由すべて、iframe、再起動の後でも効いた。後から登録した場合も、manifest に書いた場合と同じ結果だった。
- 判定の前に `chrome.storage` を読むと、毎回ページのスクリプトが先に動いた。
- リダイレクト（2026-10-19、`probe4.ts`・`probe5.ts`、`out4*.txt`・`out5.txt`。各条件 10 回）:
  - content script だけでは、ユーザー情報付き URL は同じオリジン内へ・普通のホストへのどちらのリダイレクトでも、IDN ホストと IP アドレスホストは普通のホストへのリダイレクトで、毎回すり抜けた（ページ全体・iframe とも）。
  - `onBeforeNavigate` で `tabs.update` を呼ぶと、ページ全体の遷移では、拡張機能の service worker が動作中ならページのスクリプトは一度も動かなかった。停止中はすり抜けるすべての場合で毎回スクリプトが動いたが、最後は毎回警告ページになった。
  - `onCommitted` で移すと、動作中でも毎回スクリプトが動いた。iframe を `onCommitted` で移すと、動作中で 10 回中 2〜4 回スクリプトが動き、最後は毎回警告ページになった。iframe の停止中は、測定コードの不具合で有効に測れていない（Phase 0 で測る）。
  - 描画は見ていない（Phase 0 で見た）。

## 作業

### Phase 0: 実装前の確認

- [x] 履歴の確認: Service Worker が応答したページは、content script が動く前に確定（commit）している。そのため、`location.replace` で置き換えても、元の URL がブラウザの履歴（`chrome://history`）に残るかもしれない。測定用の拡張機能で `chrome.history` を使って確かめる（本体には `history` 権限を足さない）。
  - 残らない場合: Phase 1 へ進む。Phase 3 の E2E で、残らないことを確かめる。
  - 残る場合: **ここで実装を止める。** FR-8 の履歴の部分を満たせないので、次のどちらかをユーザーと決めるまで Phase 1 に進まない。
    - FR-8 を満たす別の方式を探し、同じ条件で測ってから比べる。
    - 要求仕様書の FR-8・対象外・V-2b を改め、履歴に残ることを限界として再合意する。
  - どちらの場合も、結果と決定をこの計画と要求仕様書に書く。
  - **結果（2026-10-19、`probe6.ts`、`out7-P1.txt`・`out7-P2.txt`。各 10 回）: 残らない。** content script が移した遷移では、タブの履歴に残るのはパスワードを伏せた警告ページだけだった（拡張機能の service worker の動作中・停止中とも）。`chrome.history` には、平文のパスワードは一度も入らなかった（Chrome 自身がユーザー情報を除いて記録する。PunyGuard がなくても同じ）。

- [x] 描画の確認（AC-1）: content script があっても、攻撃者のページの先頭（スクリプトより前）に置いた画像は、毎回サーバーに届いた（2026-10-19、headless の Chromium 156。ページ全体で 45 回中 45 回、iframe で 10 回中 10 回）。スクリプトのビーコンは、一度も届かなかった。この画像は、ブラウザの先読みで取りに行っただけかもしれないし、ページの中身が読まれて描画まで進んでいるのかもしれない。画像の読み込みでは、この 2 つを区別できない。そこで、先読みと関係なく描画を見られる方法で確かめる。
  - 観測方法: CDP の描画イベント（トレースの Paint）か、画面のキャプチャ（`Page.startScreencast`）で、攻撃者のページの中身が描画されたかを見る。
  - 観測方法の陽性対照: content script がない場合に、攻撃者のページの描画を捉えられることを確かめる。
  - 観測方法の陰性対照: 描画が起きないと分かっている場合に、描画を捉えないことを確かめる。例えば、DNR で遮断される Service Worker なしの遷移を使う。
  - 描画されない場合: Phase 1 へ進む。Phase 3 の E2E でも、この観測方法で AC-1 を確かめる。
  - 描画される場合: **ここで実装を止める。** AC-1 を満たす別の方法（例: 移す前にページの読み込みを止める）を、同じ条件で測ってから比べる。決めるのはユーザー。結果と決定を、この計画・要求仕様書・ADR-0004 に書く。
  - リダイレクトの場合は AC-1 を求めない（AC-4）ので、この確認の対象外とする。
  - **結果（2026-10-19、CDP のトレース。各 10 回）: 描画されない。** 攻撃者の文書が確定してから次の文書が確定するまでの間に、そのフレームで起きた `firstContentfulPaint`・`firstPaint`・`Paint` を数えた。ページ全体の遷移では、content script が移す場合、3 つとも 0 回だった。iframe では `firstContentfulPaint` が 0 回で、イベントを詳しく見た試行（各状態 2 回）では `Paint` も出ていなかった。陽性対照（content script なし）では毎回 `firstContentfulPaint` を捉え、陰性対照（DNR で遮断される遷移）では何も捉えなかった。
  - 観測の注意: 埋め込み元のページの URL に試行の ID を入れると、そのページの描画を攻撃者の分として数えてしまう。埋め込み元の文書は数えない。

- [x] リダイレクトの iframe（AC-4）: 拡張機能の service worker が停止中のとき、リダイレクトされた IDN ホスト・IP アドレスホストの iframe が、最後に警告ページになるかを測る。前回の測定は、フレームの URL を取れずに無効だった。測り方を直し、動作中も含めて測り直す。
  - 最後に警告ページになる場合: Phase 1 へ進む。
  - ならない場合: **ここで実装を止める。** 別の方法を同じ条件で測って比べるか、要求を改めて再合意するかを、ユーザーと決める。
  - **結果: なる。** IDN ホスト・IP アドレスホストとも、動作中・停止中とも、10 回中 10 回、最後に警告ページになった。
  - 測る途中で分かったこと: Playwright は、ストレージのパーティション分割（`ThirdPartyStoragePartitioning`）を無効にして Chromium を起動する。実際の Chrome では分割されるので、トップレベルで登録した Service Worker は、別サイトに埋め込まれた iframe を制御しない。攻撃者の Service Worker が iframe に効くのは、同じトップレベルのサイトの下で登録された場合である。この測定は、分割を有効にし、埋め込み先の下で登録して行った。

- [x] 二重に動かないか: `onBeforeNavigate` で `tabs.update` を呼ぶと、DNR が遮断する遷移や、content script が移す遷移でも動く。二重に移したときに、履歴の項目が増えたり、警告ページの URL が変わったりしないかを確かめる。
  - 問題がない場合: そのまま進む。
  - 問題がある場合: 動く条件を絞る方法（例: DNR が遮断する遷移を除く）を測ってから決める。この計画に書く。
  - **結果: `onBeforeNavigate` で `tabs.update` を呼ぶ方式には問題があった。** 拡張機能の service worker が停止中だと、遅れて届いた `tabs.update` が新しい履歴の項目を作った（10 回中 10 回）。警告ページが 2 つ並び、平文のパスワード付きの攻撃者の URL や、リダイレクト先の攻撃者のページが「戻る」に残った。
  - `onCommitted` でリダイレクトされたと分かったときだけ `location.replace` させる方式を同じ条件で測ると、どの条件でもタブの履歴は警告ページの 1 項目だった。代わりに、リダイレクトの場合は動作中でもページのスクリプトが動いた（ページ全体で 10 回中 10 回。`firstContentfulPaint` は最大 10 回中 3 回）。これは AC-4 の範囲内である。ユーザーと決めて、こちらを採った（2026-10-19）。

- [x] リダイレクトの履歴: 上の履歴の確認を、リダイレクトを追う経路でも行う。残る場合の扱いは、上の履歴の確認と同じ。
  - **結果: 残らない。** 採った方式では、タブの履歴にも `chrome.history` にも、パスワードを伏せた警告ページだけが残った。

### Phase 1: content script の判定（TDD）

- [x] seam をユーザーと確認した（2026-10-19。Phase 1b・Phase 2 の seam も合わせて確認した）。
  - 判定: URL と設定から、移す先（パスワードを伏せた警告ページの URL）または「移さない」を返す
  - 登録内容: 設定から、`registerContentScripts`／`updateContentScripts` に渡す内容
  - 登録の管理: `protection.ts` の流れ（登録済みかどうかで呼ぶ API を選ぶこと、失敗を問題として集約すること）
- [x] 判定の単体テスト（`src/core/warning-target.test.ts`。`warningTarget`）:
  - 3 つの遮断理由と設定の組み合わせ
  - http と https 以外は移さないこと
  - パスワードは `***` に伏せ、ユーザー名は残すこと
- [x] content script のエントリを足した（`src/content.ts`、esbuild の `ENTRY_POINTS`）。判定は `findBlockReasons` を使い、ページの DOM には触らない。
- [x] 設定を content script に渡す方法: 設定の組み合わせ（8 通り）ごとに、設定を content script の世界に宣言するだけの小さなスクリプト（`content-settings/<3 桁>.js`）を、判定スクリプトの前に読み込ませる。`scripts/build.ts` が `settingsScripts()` から `dist/` に書き出す。
  - 単体テスト（`src/core/content-script.test.ts`）: 8 通りすべてで、登録内容が指す設定スクリプト（ビルドが書く内容）を実行すると、content script が同じ設定を読むこと。宣言がない・壊れているときは、すべて遮断する既定の設定になること。

### Phase 1b: リダイレクトを追う仕組み（TDD）

- [x] seam をユーザーと確認した。実装では、イベントの順序に合わせて 2 つに分けた（`src/core/redirect-tracking.ts`）。
  - 開始の記録（`createStartTracker`）: `started` は、どれかの設定で遮断されうる開始だけを記録する（設定は確定のときに読むため、すべて遮断する既定の設定で判定する）。ほかの URL は持たない。同じフレームで新しい遷移が始まったら、前の記録は必ず置き換える（Chrome は、前の遷移の失敗より先に新しい遷移の開始を知らせることがあり、残すと普通のページを警告ページへ移してしまうため）。`ended` は記録を一度だけ返して消す（確定・失敗のとき）。
  - 判定（`redirectedFrameTarget`）: 開始の URL・確定した URL・設定から、移す先か `null` を返す。
- [x] 単体テスト（`src/core/redirect-tracking.test.ts`）:
  - 開始の URL が遮断理由に当たり、確定した URL が遮断理由に当たらないときだけ移すこと
  - 確定した URL が遮断理由に当たる（content script に任せる）か、警告ページ（DNR が移した）なら移さないこと
  - 設定で無効にした遮断理由・除外したプライベート IP アドレスでは移さないこと
  - パスワードを伏せた移す先を使うこと
  - 覚えた開始は、確定・失敗のときに消すこと。フレームごとに分けること。普通の URL での新しい開始で、前の記録を消すこと
- [x] `background.ts` に `webNavigation` のリスナーを足した。リスナーはトップレベルで同期的に登録する。`onCommitted` では、設定を読む前に記録を同期で取り出す（読む間に同じフレームで始まった遷移の記録を消さないため）。設定は判定のたびに `chrome.storage` から読む。

### Phase 2: 登録の管理（TDD）

- [x] `protection.ts` の流れに、content script の登録を加えた。呼ぶ時期と手順は、上の「登録の手順」のとおり。
- [x] 単体テスト（`src/core/protection-content-script.test.ts`。偽物のブラウザは `src/core/test-support/fake-browser.ts` に移した）:
  - 未登録なら `registerContentScripts` を、登録済みなら `updateContentScripts` を呼ぶこと。解除の API は依存に含めない
  - content script の登録・更新だけが失敗したとき、`!` バッジが付き、ツールチップに新しい問題の行が出て、エラーを記録すること
  - DNR ルールの登録と content script の登録が両方失敗したときに、両方の行が出ること
  - 成功したときに、バッジが消えること
- [x] 新しいメッセージキー `problemContentScriptNotRegistered` を `PROTECTION_MESSAGE_KEYS` と両方の言語のカタログに足した（文言はユーザーが確認した。2026-10-19）。
- [x] `manifest.json` に `scripting` と `webNavigation` を足した。

### Phase 2b: 既存のコードの点検（2026-10-19、ユーザーの指示）

「起きないケースのコードは実装もテストも置かず、文書に残す」方針で、既存のコード（HEAD）を 4 つの範囲に分けて点検した。修正は、推測にとどまる項目を確かめ、結果をユーザーに示してから行う。

- [x] 推測にとどまる項目を、Chromium のソース・公式のドキュメントと Context7・実際の検証で確かめた（`openOptionsPage` の `catch` は、ドキュメントが「ほかの理由」での失敗を認めるので残す）: 遮断ルールの正規表現の `[/?#]`（URL の正規化）、`permissions.contains`・`setBadgeText`／`setTitle`・`openOptionsPage` の失敗の条件、sandbox 付きの iframe の分岐（`e2e/blocking.spec.ts`）
- [x] 調べた結果をまとめてユーザーに示した
- [x] 確認済みの項目と、確かめた項目（正規表現、`permissions.contains` の `catch`、`createProtector` の `.catch`、`protect()` の `catch`、sandbox 付きの iframe の分岐）を直した: `redirect-target.ts` の大文字小文字の分岐、`blocked.ts` の文字の種類の名前のフォールバック、`options.ts` の `.catch`、`settings-storage.ts` のキーの確認、E2E の失敗しえない確かめ 3 つ
- [x] 型の都合だけの分岐に理由のコメントを書いた。`protection.test.ts` の偽のエラーを内部の失敗に替える。`options.ts` の `showSaveFailed` を throw にそろえる
- [x] E2E の不安定さを直した: 設定を変えた直後の遷移で、content script がまだ古い設定のまま警告ページへ移すことがあった（今回の作業後は 45 回中 5 回失敗、HEAD では 45 回とも成功）。拡張機能は遮断ルールの後で content script を更新するのに、`saveSettings` は遮断ルールしか待っていなかった。content script の登録が新しい設定に変わるまで待つようにし、45 回とも成功、E2E 全体を 3 回繰り返して 201 件成功（スキップ 9 件は Linux 専用の言語のテスト）。
- 残すと決めたもの: 保存された設定が壊れている場合の扱い（ADR-0003。DevTools で手で書き換えるのも利用者ができる操作のため。ユーザーと決定）

### Phase 3: E2E

- 進め方（2026-10-19、ユーザーと決定）: 既存の E2E を 1 回通してから、共通の土台（Service Worker を事前に登録したプロファイル、パーティション分割の有効化、拡張機能の service worker を止める仕組み）を作る。その後、spec ごとにサブエージェントを分け、別々の git worktree で並行して書く。最後に 1 か所で全部を通す。同じ E2E を並行で何本も実行することはしない（`dist/` の取り合いと、時間を見るテストが負荷で不安定になるため）。

- [ ] ストレージのパーティション分割を有効にして実行する。Playwright は既定で `--disable-features` に `ThirdPartyStoragePartitioning` を含めるので、これを外す方法を決める。分割が有効なことは、iframe の陽性対照（トップレベルで登録した Service Worker が、別サイトに埋め込まれた iframe を制御しないこと）で確かめる。
- [ ] Service Worker を事前に登録したプロファイルを用意する仕組みを作る（`e2e/support/`）。iframe 用の Service Worker は、埋め込み先のページの中の iframe から登録する（同じトップレベルのサイトの下に登録するため）。中継型（`fetch(event.request)`）と自作型（`new Response(...)`）の 2 種類の Service Worker を用意する。どちらも遷移（`event.request.mode === "navigate"`）にだけ応答し、ビーコンなどほかのリクエストには応答しない。こうすると、それらのリクエストはネットワークを通ってテストサーバーに届く。
- [ ] 拡張機能の service worker を止める仕組みを作る（CDP の `ServiceWorker.stopWorker` など。止まったことも確かめる）。
- [ ] 観測の方法を決める。ページ全体の遷移と iframe の中の遷移の、どちらにも使う。
  - 描画（AC-1）: Phase 0 で決めた、先読みと関係のない観測方法（CDP の描画イベントか画面のキャプチャ）で見る。画像の読み込みは、先読みでも起きるので、AC-1 の判定には使わない。
  - スクリプト（AC-2）: ページのスクリプトが送るビーコンで見る。
  - 陽性対照: PunyGuard を入れる前のプロファイル（Service Worker を登録する段階）で、次のすべての組み合わせを開き、ビーコンがサーバーに届くこと、および描画を捉えられることを確かめる。捉えられない組み合わせでは、その観測方法が使えないので、「捉えなかった」ことを遮断の証拠にしない。
    - 遮断理由: 3 つ
    - Service Worker の種類: 中継型／自作型
    - 開き方: ページ全体／iframe

    ただし、ユーザー情報付き URL の中継型と iframe は、Chrome 自身が拒否するので、対照からは外す（下の各項目を参照）。
- [ ] ページ全体の遷移（AC-1〜AC-3）: 3 つの遮断理由それぞれについて、次の 4 通りすべてで確かめる。1 回目の遷移が警告ページになり、攻撃者のページの描画を捉えず、ビーコンもサーバーに届かないこと。
  - Service Worker の種類: 中継型／自作型
  - 拡張機能の service worker: 動作中／停止中

  ユーザー情報付き URL を中継型で開くと、Chrome は中継を拒否する（2026-10-18 の調査）。それでも、警告ページになり、描画もビーコンもないことを確かめる。

- [ ] iframe の中の遷移（AC-1・AC-2）:
  - IDN ホストと IP アドレスホストでは、フレーム内が警告ページになり、フレームの中の描画を捉えず、ビーコンも届かないことを確かめる。Service Worker は中継型と自作型の両方で試す。
  - ユーザー情報付き URL では、警告ページにはならず、読み込まれず、描画もビーコンもないことを確かめる（Chrome の拒否）。
- [ ] リダイレクト（FR-9・AC-4、要求仕様書の V-2d）: リダイレクトで応答する Service Worker（同じオリジン内へ・普通のホストへ）を用意する。3 つの遮断理由、ページ全体と iframe、拡張機能の service worker の動作中と停止中のすべての組み合わせで、最後に警告ページになることを確かめる。ユーザー情報付き URL の iframe は、Chrome が拒否するので外す。同じオリジン内へのリダイレクトで、IDN ホストと IP アドレスホストのリダイレクト先が遮断理由に当たる場合は、content script が移すことも確かめる。
- [ ] パスワード: パスワード付きの URL を Service Worker 経由で開いたとき（リダイレクトの場合を含む）、警告ページのアドレスバーにパスワードが `***` で出ることを確かめる。履歴に平文が残らないことも確かめる（Phase 0 で再合意して要求を改めた場合は、改めた要求に従う）。
- [ ] 設定: ユーザー情報付き URL や IP アドレスホストの遮断を無効にすると、Service Worker の応答が表示されることを確かめる。プライベート IP アドレスを除外した場合も確かめる。
- [ ] 設定を切り替えた直後の遷移に、正しい設定が効くことを確かめる。
- [ ] ブラウザを再起動した後と、拡張機能を更新（再読み込み）した後も効くことを確かめる。
- [ ] 権限の警告文が増えないことを確かめる（`management.getPermissionWarningsByManifest` を、変更前と変更後の manifest で比べる）。

### Phase 4: 文書

- [ ] README・README.ja: 「content script を持たない」を改め、content script がすることを書く。既知の制限を書き換える（Service Worker 自身は動きうる。リダイレクトの場合は警告ページに置き換わる前に一瞬表示・実行されうる。Phase 0 の結果によっては履歴のことも）。
- [ ] docs/decisions.md の P3: 「遮断しない」から「content script で遮断する」へ書き換え、ADR-0004 へリンクする。
- [ ] ADR-0002 の Consequences に、ADR-0004 で置き換えたことを書く。
- [x] CONTEXT.md の Service Worker の行を書き換え、リダイレクトの行を足した。
- [x] ADR-0004 を書いた（実装の結果で、数字や記述を見直す）。

### Phase 5: 確認

- [ ] `direnv exec . pnpm run check` と `direnv exec . pnpm run test:e2e` が通る。
- [ ] 要求仕様書の FR・AC・C・V のそれぞれについて、どのテストで確かめたかを対応づける。
- [ ] レビュー
