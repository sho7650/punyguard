# Service Workerが応答する遷移の遮断 計画（Phase 3まで完了）

[todo-security-hardening.md](todo-security-hardening.md)のPhase 2で、Service Workerが応答する遷移にはdeclarativeNetRequestが効かないと分かった（[docs/decisions.md](../docs/decisions.md)のP3）。ユーザー情報付きURLは、攻撃者が自分のサイトに一度来させてService Workerを登録させれば、PunyGuardを入れた後でもすり抜けられる。要求は[requirements-service-worker-bypass.md](requirements-service-worker-bypass.md)、設計は[ADR-0004](../docs/adr/0004-content-script-blocks-service-worker-navigation.md)に記録した。

## 決まったこと（2026-10-19）

- **成功の基準**: Service Workerが応答する遷移でも、攻撃者のページを描画させず、ページのスクリプトも動かさない。Service Worker自身が応答する時点で動くことは、防げない限界としてREADMEに書く。Service Workerがリダイレクトで応答した場合は、最後に必ず警告ページへ置き換える（要求仕様書のFR-9・AC-4）。置き換わる前にリダイレクト先のページが表示され、動きうることは、限界としてREADMEに書く。
- **方式**（リダイレクトしない応答）: `document_start`で動くcontent script（全フレーム）が`document.URL`を判定し、遮断理由に当たれば`location.replace`で警告ページへ移す。`browsingData`によるService Workerの削除は行わない（中継中に消すと白紙で止まるため）。
- **リダイレクトの方式**: Service Workerがリダイレクトで応答すると、content scriptが見る`document.URL`はリダイレクト先になり、元のURLを知る手段がない（2026-10-19に測定。`redirectCount`・`referrer`・`navigation.activation`のどれにも元のURLは出ない）。そこで、拡張機能のservice workerが`webNavigation.onBeforeNavigate`で、遮断理由に当たる遷移の開始をタブとフレームごとに覚える。
  - `onCommitted`で、覚えた遷移が遮断理由に当たらないURLで確定したら（リダイレクトされた）、`scripting.executeScript`でそのフレームに`location.replace`させ、警告ページへ移す。ページ全体の遷移とiframeで同じ仕組みを使う。
  - 確定したURLが遮断理由に当たる場合（content scriptが移す）と、警告ページの場合（DNRが移した）は何もしない。
  - `location.replace`は履歴の項目を置き換えるので、タブの履歴に攻撃者のページや平文のパスワードが残らない。`onBeforeNavigate`の時点で`tabs.update`を呼ぶ方式は採らない（Phase 0で、拡張機能のservice workerが停止中だと新しい履歴の項目を作り、平文のパスワード付きのURLや攻撃者のページが「戻る」に残ったため）。
  - 判定（`findBlockReasons`）・設定・移す先（パスワードを伏せる）は、content scriptと同じものを使う。
  - `tabs`権限は使わない。
- **対象**: 3つの遮断理由すべて（IDNホスト・ユーザー情報付きURL・IPアドレスホスト）。判定は既存の`findBlockReasons`を使う。DNRルールと同じく、httpとhttpsのURLだけを対象にする。
- **移す先**: DNRルールと同じ`blocked.html#<元のURL>`とし、元のURLのパスワードは移す前に`***`に伏せる（`blocked-url.ts`の`maskPassword`）。DNRルールの`passwordRule`と同じく、警告ページのアドレスバーと履歴に平文のパスワードを残さないため。
- **ユーザー情報付きURLのiframe**: ChromeがService Workerより先に読み込みを拒否する（2026-10-18の調査）。今の遮断と同じく警告ページにはならないが、読み込まれず、スクリプトも動かない。content scriptでは何もしない。
- **設定の渡し方**: content scriptは判定の時点で設定を読まない（`chrome.storage`は非同期で、ページのスクリプトが先に動く）。拡張機能のservice workerが、登録の時点で設定をcontent scriptに渡す（下の「登録の手順」）。
- **登録の手順**:
  - 登録IDは1つに固定し、`persistAcrossSessions: true`（既定値）で登録する。
  - 同じIDで`registerContentScripts`を呼ぶと失敗する。そのため、`getRegisteredContentScripts({ ids })`で登録済みかを確かめ、登録済みなら`updateContentScripts`、未登録なら`registerContentScripts`を呼ぶ。
  - 解除してから登録し直すことはしない。解除と登録の間の遷移が無防備になるため。
  - 呼ぶ時期は、インストール時（更新・再読み込みを含む）、起動時、設定の変更時、サイトへのアクセス権の変更時。DNRルールの登録と同じ時期。
- **登録の失敗**: DNRルールの登録に失敗した場合と同じく、問題として`!`バッジとツールチップで知らせる。ツールチップの文言は、新しいメッセージキーで足す（英語と日本語）。
- **登録の失敗の扱い**（2026-10-19、ユーザーと決定）: 失敗は`!`バッジで知らせるだけにする。リダイレクトを追う仕組みを予備として動かすことはしない。調査では、今の作りで失敗するのは、登録の処理中に拡張機能が再読み込み・無効化された場合（一時的で、`onInstalled`で登録し直す）と、同梱ファイルが欠けた・UTF-8でない場合（ビルドや配布の不具合）に限られた。
  - 起きないと分かったケース（同じIDの二重登録、未登録のIDの更新、`getRegisteredContentScripts`の失敗、ID・`matches`・ファイル・大きさの不備、サイトへのアクセスやポリシーによる登録の失敗）には、実装もテストも書かず、理由を文書に残す（ユーザーの方針）。
  - 拡張機能の更新で動的な登録が残るか（2026-10-20に測定）: ブラウザの再起動（10回中10回）と無効化→有効化（5回中5回）では残る。更新と再読み込みでは消え（各5回中5回）、`onInstalled`が70〜83ミリ秒で登録し直す。E2Eの環境は`--load-extension`で起動のたびに入れ直すので、起動し直しても消える。
- **権限**: `scripting`と`webNavigation`を足す。インストール時の警告文は増えない（確認済み）。
- **E2EでのService Workerの用意**: PunyGuardを入れていないプロファイルで、先にサイトを開いてService Workerを登録する。その後でPunyGuardを入れて起動する。テスト用ホストは`--unsafely-treat-insecure-origin-as-secure`で安全なオリジンとして扱う。
- **`<object>`・`<embed>`**: この2つの中の遷移にはService Workerが応答しないので、引き続きDNRだけで遮断する。
- **限界として認めたこと**（2026-10-20、ユーザーと決定。要求仕様書のFR-2・対象外、ADR-0004）:
  - ユーザー情報付きURLへの遷移をService Workerが中継すると、Chromeが遷移を失敗させてエラーページになる（PunyGuardの有無によらない）。タブの履歴とアドレスバーに平文のパスワード付きのURLが残るが、エラーページには手を出せず、`tabs.update`で移しても「戻る」に残った（10回中10回）ので、何もしない。
  - 更新・再読み込みの直後、content scriptを登録し直すまでの70〜83ミリ秒は、Service Workerが応答する遷移を遮断できない。manifestに書くcontent scriptは設定を渡せないので採らない。

## 根拠（Chromium 156、headlessで測定）

測定スクリプトと結果はscratchpadの`sw-api-research/`（`probe-all.ts`、`probe2.ts`、`probe4.ts`〜`probe6.ts`、`out-all*.txt`、`out2.txt`、`out4*.txt`〜`out7-*.txt`）に置いた。

- 候補ごとに、同じ条件で比べた。攻撃者のService Workerは中継型と自作型の2種類、拡張機能のservice workerは動作中と停止中の2通りで、それぞれ20回試した。content scriptだけが、すべての条件で、攻撃者のページのスクリプトを動かさなかった。描画（AC-1）は、この測定では見ていない（Phase 0で確かめる）。`onBeforeNavigate`から`tabs.update`で移す方法は、拡張機能のservice workerが止まっていると毎回負けた。
- content scriptは、3つの遮断理由すべて、iframe、再起動の後でも効いた。後から登録した場合も、manifestに書いた場合と同じ結果だった。
- 判定の前に`chrome.storage`を読むと、毎回ページのスクリプトが先に動いた。
- リダイレクト（2026-10-19、`probe4.ts`・`probe5.ts`、`out4*.txt`・`out5.txt`。各条件10回）:
  - content scriptだけでは、ユーザー情報付きURLは同じオリジン内へ・普通のホストへのどちらのリダイレクトでも、IDNホストとIPアドレスホストは普通のホストへのリダイレクトで、毎回すり抜けた（ページ全体・iframeとも）。
  - `onBeforeNavigate`で`tabs.update`を呼ぶと、ページ全体の遷移では、拡張機能のservice workerが動作中ならページのスクリプトは一度も動かなかった。停止中はすり抜けるすべての場合で毎回スクリプトが動いたが、最後は毎回警告ページになった。
  - `onCommitted`で移すと、動作中でも毎回スクリプトが動いた。iframeを`onCommitted`で移すと、動作中で10回中2〜4回スクリプトが動き、最後は毎回警告ページになった。iframeの停止中は、測定コードの不具合で有効に測れていない（Phase 0で測る）。
  - 描画は見ていない（Phase 0で見た）。

## 作業

### Phase 0: 実装前の確認

- [x] 履歴の確認: Service Workerが応答したページは、content scriptが動く前に確定（commit）している。そのため、`location.replace`で置き換えても、元のURLがブラウザの履歴（`chrome://history`）に残るかもしれない。測定用の拡張機能で`chrome.history`を使って確かめる（本体には`history`権限を足さない）。
  - 残らない場合: Phase 1へ進む。Phase 3のE2Eで、残らないことを確かめる。
  - 残る場合: **ここで実装を止める。** FR-8の履歴の部分を満たせないので、次のどちらかをユーザーと決めるまでPhase 1に進まない。
    - FR-8を満たす別の方式を探し、同じ条件で測ってから比べる。
    - 要求仕様書のFR-8・対象外・V-2bを改め、履歴に残ることを限界として再合意する。
  - どちらの場合も、結果と決定をこの計画と要求仕様書に書く。
  - **結果（2026-10-19、`probe6.ts`、`out7-P1.txt`・`out7-P2.txt`。各10回）: 残らない。** content scriptが移した遷移では、タブの履歴に残るのはパスワードを伏せた警告ページだけだった（拡張機能のservice workerの動作中・停止中とも）。`chrome.history`には、平文のパスワードは一度も入らなかった（Chrome自身がユーザー情報を除いて記録する。PunyGuardがなくても同じ）。

- [x] 描画の確認（AC-1）: content scriptがあっても、攻撃者のページの先頭（スクリプトより前）に置いた画像は、毎回サーバーに届いた（2026-10-19、headlessのChromium 156。ページ全体で45回中45回、iframeで10回中10回）。スクリプトのビーコンは、一度も届かなかった。この画像は、ブラウザの先読みで取りに行っただけかもしれないし、ページの中身が読まれて描画まで進んでいるのかもしれない。画像の読み込みでは、この2つを区別できない。そこで、先読みと関係なく描画を見られる方法で確かめる。
  - 観測方法: CDPの描画イベント（トレースのPaint）か、画面のキャプチャ（`Page.startScreencast`）で、攻撃者のページの中身が描画されたかを見る。
  - 観測方法の陽性対照: content scriptがない場合に、攻撃者のページの描画を捉えられることを確かめる。
  - 観測方法の陰性対照: 描画が起きないと分かっている場合に、描画を捉えないことを確かめる。例えば、DNRで遮断されるService Workerなしの遷移を使う。
  - 描画されない場合: Phase 1へ進む。Phase 3のE2Eでも、この観測方法でAC-1を確かめる。
  - 描画される場合: **ここで実装を止める。** AC-1を満たす別の方法（例: 移す前にページの読み込みを止める）を、同じ条件で測ってから比べる。決めるのはユーザー。結果と決定を、この計画・要求仕様書・ADR-0004に書く。
  - リダイレクトの場合はAC-1を求めない（AC-4）ので、この確認の対象外とする。
  - **結果（2026-10-19、CDPのトレース。各10回）: 描画されない。** 攻撃者の文書が確定してから次の文書が確定するまでの間に、そのフレームで起きた`firstContentfulPaint`・`firstPaint`・`Paint`を数えた。ページ全体の遷移では、content scriptが移す場合、3つとも0回だった。iframeでは`firstContentfulPaint`が0回で、イベントを詳しく見た試行（各状態2回）では`Paint`も出ていなかった。陽性対照（content scriptなし）では毎回`firstContentfulPaint`を捉え、陰性対照（DNRで遮断される遷移）では何も捉えなかった。
  - 観測の注意: 埋め込み元のページのURLに試行のIDを入れると、そのページの描画を攻撃者の分として数えてしまう。埋め込み元の文書は数えない。

- [x] リダイレクトのiframe（AC-4）: 拡張機能のservice workerが停止中のとき、リダイレクトされたIDNホスト・IPアドレスホストのiframeが、最後に警告ページになるかを測る。前回の測定は、フレームのURLを取れずに無効だった。測り方を直し、動作中も含めて測り直す。
  - 最後に警告ページになる場合: Phase 1へ進む。
  - ならない場合: **ここで実装を止める。** 別の方法を同じ条件で測って比べるか、要求を改めて再合意するかを、ユーザーと決める。
  - **結果: なる。** IDNホスト・IPアドレスホストとも、動作中・停止中とも、10回中10回、最後に警告ページになった。
  - 測る途中で分かったこと: Playwrightは、ストレージのパーティション分割（`ThirdPartyStoragePartitioning`）を無効にしてChromiumを起動する。実際のChromeでは分割されるので、トップレベルで登録したService Workerは、別サイトに埋め込まれたiframeを制御しない。攻撃者のService Workerがiframeに効くのは、同じトップレベルのサイトの下で登録された場合である。この測定は、分割を有効にし、埋め込み先の下で登録して行った。

- [x] 二重に動かないか: `onBeforeNavigate`で`tabs.update`を呼ぶと、DNRが遮断する遷移や、content scriptが移す遷移でも動く。二重に移したときに、履歴の項目が増えたり、警告ページのURLが変わったりしないかを確かめる。
  - 問題がない場合: そのまま進む。
  - 問題がある場合: 動く条件を絞る方法（例: DNRが遮断する遷移を除く）を測ってから決める。この計画に書く。
  - **結果: `onBeforeNavigate`で`tabs.update`を呼ぶ方式には問題があった。** 拡張機能のservice workerが停止中だと、遅れて届いた`tabs.update`が新しい履歴の項目を作った（10回中10回）。警告ページが2つ並び、平文のパスワード付きの攻撃者のURLや、リダイレクト先の攻撃者のページが「戻る」に残った。
  - `onCommitted`でリダイレクトされたと分かったときだけ`location.replace`させる方式を同じ条件で測ると、どの条件でもタブの履歴は警告ページの1項目だった。代わりに、リダイレクトの場合は動作中でもページのスクリプトが動いた（ページ全体で10回中10回。`firstContentfulPaint`は最大10回中3回）。これはAC-4の範囲内である。ユーザーと決めて、こちらを採った（2026-10-19）。

- [x] リダイレクトの履歴: 上の履歴の確認を、リダイレクトを追う経路でも行う。残る場合の扱いは、上の履歴の確認と同じ。
  - **結果: 残らない。** 採った方式では、タブの履歴にも`chrome.history`にも、パスワードを伏せた警告ページだけが残った。

### Phase 1: content scriptの判定（TDD）

- [x] seamをユーザーと確認した（2026-10-19。Phase 1b・Phase 2のseamも合わせて確認した）。
  - 判定: URLと設定から、移す先（パスワードを伏せた警告ページのURL）または「移さない」を返す
  - 登録内容: 設定から、`registerContentScripts`／`updateContentScripts`に渡す内容
  - 登録の管理: `protection.ts`の流れ（登録済みかどうかで呼ぶAPIを選ぶこと、失敗を問題として集約すること）
- [x] 判定の単体テスト（`src/core/warning-target.test.ts`。`warningTarget`）:
  - 3つの遮断理由と設定の組み合わせ
  - httpとhttps以外は移さないこと
  - パスワードは`***`に伏せ、ユーザー名は残すこと
- [x] content scriptのエントリを足した（`src/content.ts`、esbuildの`ENTRY_POINTS`）。判定は`findBlockReasons`を使い、ページのDOMには触らない。
- [x] 設定をcontent scriptに渡す方法: 設定の組み合わせ（8通り）ごとに、設定をcontent scriptの世界に宣言するだけの小さなスクリプト（`content-settings/<3桁>.js`）を、判定スクリプトの前に読み込ませる。`scripts/build.ts`が`settingsScripts()`から`dist/`に書き出す。
  - 単体テスト（`src/core/content-script.test.ts`）: 8通りすべてで、登録内容が指す設定スクリプト（ビルドが書く内容）を実行すると、content scriptが同じ設定を読むこと。宣言は登録内容が必ず先に読み込むので、宣言がない場合のテストと実装は置かない（起きないケースにコードを置かない方針。理由は`content-script.ts`のコメント）。

### Phase 1b: リダイレクトを追う仕組み（TDD）

- [x] seamをユーザーと確認した。実装では、イベントの順序に合わせて2つに分けた（`src/core/redirect-tracking.ts`）。
  - 開始の記録（`createStartTracker`）: `started`は、どれかの設定で遮断されうる開始だけを記録する（設定は確定のときに読むため、すべて遮断する既定の設定で判定する）。ほかのURLは持たない。同じフレームで新しい遷移が始まったら、前の記録は必ず置き換える（Chromeは、前の遷移の失敗より先に新しい遷移の開始を知らせることがあり、残すと普通のページを警告ページへ移してしまうため）。`ended`は記録を一度だけ返して消す（確定・失敗のとき）。
  - 判定（`redirectedFrameTarget`）: 開始のURL・確定したURL・設定から、移す先か`null`を返す。
- [x] 単体テスト（`src/core/redirect-tracking.test.ts`）:
  - 開始のURLが遮断理由に当たり、確定したURLが遮断理由に当たらないときだけ移すこと
  - 確定したURLが遮断理由に当たる（content scriptに任せる）か、警告ページ（DNRが移した）なら移さないこと
  - 設定で無効にした遮断理由・除外したプライベートIPアドレスでは移さないこと
  - パスワードを伏せた移す先を使うこと
  - 覚えた開始は、確定・失敗のときに消すこと。フレームごとに分けること。普通のURLでの新しい開始で、前の記録を消すこと
- [x] `background.ts`に`webNavigation`のリスナーを足した。リスナーはトップレベルで同期的に登録する。`onCommitted`では、設定を読む前に記録を同期で取り出す（読む間に同じフレームで始まった遷移の記録を消さないため）。設定は判定のたびに`chrome.storage`から読む。

### Phase 2: 登録の管理（TDD）

- [x] `protection.ts`の流れに、content scriptの登録を加えた。呼ぶ時期と手順は、上の「登録の手順」のとおり。
- [x] 単体テスト（`src/core/protection-content-script.test.ts`。偽物のブラウザは`src/core/test-support/fake-browser.ts`に移した）:
  - 未登録なら`registerContentScripts`を、登録済みなら`updateContentScripts`を呼ぶこと。解除のAPIは依存に含めない
  - content scriptの登録・更新だけが失敗したとき、`!`バッジが付き、ツールチップに新しい問題の行が出て、エラーを記録すること
  - DNRルールの登録とcontent scriptの登録が両方失敗したときに、両方の行が出ること
  - 成功したときに、バッジが消えること
- [x] 新しいメッセージキー`problemContentScriptNotRegistered`を`PROTECTION_MESSAGE_KEYS`と両方の言語のカタログに足した（文言はユーザーが確認した。2026-10-19）。
- [x] `manifest.json`に`scripting`と`webNavigation`を足した。

### Phase 2b: 既存のコードの点検（2026-10-19、ユーザーの指示）

「起きないケースのコードは実装もテストも置かず、文書に残す」方針で、既存のコード（HEAD）を4つの範囲に分けて点検した。修正は、推測にとどまる項目を確かめ、結果をユーザーに示してから行う。

- [x] 推測にとどまる項目を、Chromiumのソース・公式のドキュメントとContext7・実際の検証で確かめた（`openOptionsPage`の`catch`は、ドキュメントが「ほかの理由」での失敗を認めるので残す）: 遮断ルールの正規表現の`[/?#]`（URLの正規化）、`permissions.contains`・`setBadgeText`／`setTitle`・`openOptionsPage`の失敗の条件、sandbox付きのiframeの分岐（`e2e/blocking.spec.ts`）
- [x] 調べた結果をまとめてユーザーに示した
- [x] 確認済みの項目と、確かめた項目（正規表現、`permissions.contains`の`catch`、`createProtector`の`.catch`、`protect()`の`catch`、sandbox付きのiframeの分岐）を直した: `redirect-target.ts`の大文字小文字の分岐、`blocked.ts`の文字の種類の名前のフォールバック、`options.ts`の`.catch`、`settings-storage.ts`のキーの確認、E2Eの失敗しえない確かめ3つ
- [x] 型の都合だけの分岐に理由のコメントを書いた。`protection.test.ts`の偽のエラーを内部の失敗に替える。`options.ts`の`showSaveFailed`をthrowにそろえる
- [x] E2Eの不安定さを直した: 設定を変えた直後の遷移で、content scriptがまだ古い設定のまま警告ページへ移すことがあった（今回の作業後は45回中5回失敗、HEADでは45回とも成功）。拡張機能は遮断ルールの後でcontent scriptを更新するのに、`saveSettings`は遮断ルールしか待っていなかった。content scriptの登録が新しい設定に変わるまで待つようにし、45回とも成功、E2E全体を3回繰り返して201件成功（スキップ9件はLinux専用の言語のテスト）。
- 残すと決めたもの: 保存された設定が壊れている場合の扱い（ADR-0003。DevToolsで手で書き換えるのも利用者ができる操作のため。ユーザーと決定）

### Phase 3: E2E

- 進め方（2026-10-19、ユーザーと決定）: 既存のE2Eを1回通してから、共通の土台（Service Workerを事前に登録したプロファイル、パーティション分割の有効化、拡張機能のservice workerを止める仕組み）を作る。その後、specごとにサブエージェントを分け、別々のgit worktreeで並行して書く。最後に1か所で全部を通す。同じE2Eを並行で何本も実行することはしない（`dist/`の取り合いと、時間を見るテストが負荷で不安定になるため）。

- [x] ストレージのパーティション分割を有効にして実行する。Playwrightは既定で`--disable-features`に`ThirdPartyStoragePartitioning`を含めるので、これを外す方法を決める。分割が有効なことは、iframeの陽性対照（トップレベルで登録したService Workerが、別サイトに埋め込まれたiframeを制御しないこと）で確かめる。
  - 結果: Playwright 1.64.1の一覧から`ThirdPartyStoragePartitioning`だけを外した`--disable-features=`を後ろに足す（Chromiumは後のスイッチを使う。`e2e/support/browser-flags.ts`）。既存のE2Eも含め、すべてで有効にした。`service-worker-controls.spec.ts`が、`chrome://version`でスイッチのずれを、Service Workerがiframeを制御するかで分割の有無を確かめる。
- [x] Service Workerを事前に登録したプロファイルを用意する仕組みを作る（`e2e/support/`）。iframe用のService Workerは、埋め込み先のページの中のiframeから登録する（同じトップレベルのサイトの下に登録するため）。中継型（`fetch(event.request)`）と自作型（`new Response(...)`）の2種類のService Workerを用意する。どちらも遷移（`event.request.mode === "navigate"`）にだけ応答し、ビーコンなどほかのリクエストには応答しない。こうすると、それらのリクエストはネットワークを通ってテストサーバーに届く。
  - 結果: `e2e/support/service-worker-profile.ts`。Playwrightのワーカーごとに1回登録し（約1.0秒）、テストごとにプロファイルを複製する（約0.35秒）。リダイレクトで応答する2種類も足した。
- [x] 拡張機能のservice workerを止める仕組みを作る（CDPの`ServiceWorker.stopWorker`など。止まったことも確かめる）。
  - 結果: `e2e/support/extension-worker.ts`。止まったことはCDPの状態で確かめる。Playwrightの`Worker`は、止まっても閉じたことにならず、`evaluate`は応答しない（2026-10-20に測定）。
- [x] 観測の方法を決める。ページ全体の遷移とiframeの中の遷移の、どちらにも使う。
  - 描画（AC-1）: Phase 0で決めた、先読みと関係のない観測方法（CDPの描画イベントか画面のキャプチャ）で見る。画像の読み込みは、先読みでも起きるので、AC-1の判定には使わない。
  - スクリプト（AC-2）: ページのスクリプトが送るビーコンで見る。
  - 陽性対照: PunyGuardを入れる前のプロファイル（Service Workerを登録する段階）で、次のすべての組み合わせを開き、ビーコンがサーバーに届くこと、および描画を捉えられることを確かめる。捉えられない組み合わせでは、その観測方法が使えないので、「捉えなかった」ことを遮断の証拠にしない。
    - 遮断理由: 3つ
    - Service Workerの種類: 中継型／自作型
    - 開き方: ページ全体／iframe

    ただし、ユーザー情報付きURLの中継型とiframeは、Chrome自身が拒否するので、対照からは外す（下の各項目を参照）。

  - 結果: 描画はCDPのトレース（`e2e/support/paint-trace.ts`）、スクリプトはビーコンで見る。陽性対照は、除外した2つ（ユーザー情報付きURLの中継型とiframe）以外のすべてで捉えた。
- [x] ページ全体の遷移（AC-1〜AC-3）: 3つの遮断理由それぞれについて、次の4通りすべてで確かめる。1回目の遷移が警告ページになり、攻撃者のページの描画を捉えず、ビーコンもサーバーに届かないこと。
  - Service Workerの種類: 中継型／自作型
  - 拡張機能のservice worker: 動作中／停止中

  ユーザー情報付きURLを中継型で開くと、Chromeは中継を拒否する（2026-10-18の調査）。それでも、警告ページになり、描画もビーコンもないことを確かめる。
  - 結果: `e2e/service-worker-top-level.spec.ts`。ユーザー情報付きURLの中継型は、Chromeが遷移を失敗させてエラーページになる（限界として認めた。上の「限界として認めたこと」）。描画もビーコンもないことを確かめる。

- [x] iframeの中の遷移（AC-1・AC-2）:
  - IDNホストとIPアドレスホストでは、フレーム内が警告ページになり、フレームの中の描画を捉えず、ビーコンも届かないことを確かめる。Service Workerは中継型と自作型の両方で試す。
  - ユーザー情報付きURLでは、警告ページにはならず、読み込まれず、描画もビーコンもないことを確かめる（Chromeの拒否）。
  - 結果: `e2e/service-worker-iframe.spec.ts`。停止中は、空のiframeを入れたページを開いてから止め、その後でiframeを遷移させる（外側のページを開くとservice workerが起き直すため）。
- [x] リダイレクト（FR-9・AC-4、要求仕様書のV-2d）: リダイレクトで応答するService Worker（同じオリジン内へ・普通のホストへ）を用意する。3つの遮断理由、ページ全体とiframe、拡張機能のservice workerの動作中と停止中のすべての組み合わせで、最後に警告ページになることを確かめる。ユーザー情報付きURLのiframeは、Chromeが拒否するので外す。同じオリジン内へのリダイレクトで、IDNホストとIPアドレスホストのリダイレクト先が遮断理由に当たる場合は、content scriptが移すことも確かめる。
  - 結果: `e2e/service-worker-redirect.spec.ts`（20通り）。IDNホスト・IPアドレスホストの同じオリジン内へのリダイレクトでは、警告ページのURLがリダイレクト先になることで、content scriptが移したと分かる。
- [x] パスワード: パスワード付きのURLをService Worker経由で開いたとき（リダイレクトの場合を含む）、警告ページのアドレスバーにパスワードが`***`で出ることを確かめる。履歴に平文が残らないことも確かめる（Phase 0で再合意して要求を改めた場合は、改めた要求に従う）。
  - 結果: `e2e/service-worker-top-level.spec.ts`（アドレスバー・タブの履歴・ブラウザの履歴）と`e2e/service-worker-redirect.spec.ts`（リダイレクト）。
- [x] 設定: ユーザー情報付きURLやIPアドレスホストの遮断を無効にすると、Service Workerの応答が表示されることを確かめる。プライベートIPアドレスを除外した場合も確かめる。
  - 結果: `e2e/service-worker-settings.spec.ts`。公開IPアドレスはService Workerを用意できないので、単体テスト（`block-reasons.test.ts`）に任せる。
- [x] 設定を切り替えた直後の遷移に、正しい設定が効くことを確かめる。
  - 結果: `e2e/service-worker-settings.spec.ts`（無効にした後と、戻した後の、次の遷移）。テストは、遮断ルールとcontent scriptの登録の両方が新しい設定になるのを待ってから遷移する。保存してから登録が変わるまでのごく短い間は、前の設定で判定する（ADR-0004）。この間は確かめていない。
- [x] ブラウザを再起動した後と、拡張機能を更新（再読み込み）した後も効くことを確かめる。
  - 結果: `e2e/service-worker-lifecycle.spec.ts`（起動し直し・再読み込み・バージョンを上げた更新）。E2Eの起動し直しは入れ直しになるので、登録し直されるのを待ってから確かめる。本物の再起動で登録が残ることは測定で確かめた（上の「登録の手順」）。
- [x] 権限の警告文が増えないことを確かめる（`management.getPermissionWarningsByManifest`を、変更前と変更後のmanifestで比べる）。
  - 結果: `e2e/service-worker-lifecycle.spec.ts`。変更前も変更後も「Read and change all your data on all websites」の1行だけ。

### Phase 4: 文書

- [x] README・README.ja: 「content scriptを持たない」を改め、content scriptがすることを書く。既知の制限を書き換える（Service Worker自身は動きうる。リダイレクトの場合は警告ページに置き換わる前に一瞬表示・実行されうる。Phase 0の結果によっては履歴のことも）。
- [x] docs/decisions.mdのP3: 「遮断しない」から「content scriptで遮断する」へ書き換え、ADR-0004へリンクする。
- [x] ADR-0002のConsequencesに、ADR-0004で置き換えたことを書く。
- [x] CONTEXT.mdのService Workerの行を書き換え、リダイレクトの行を足した。
- [x] ADR-0004を書いた（実装の結果で、数字や記述を見直す）。

### Phase 5: 確認

- [ ] `direnv exec . pnpm run check`と`direnv exec . pnpm run test:e2e`が通る。
  - Phase 3の時点（2026-10-20）: checkは325件、E2Eは133件成功・3件スキップ（Linux専用の言語のテスト）。Service Workerのspec 6つを3回繰り返して198件成功。
- [ ] 要求仕様書のFR・AC・C・Vのそれぞれについて、どのテストで確かめたかを対応づける。
- [ ] レビュー
