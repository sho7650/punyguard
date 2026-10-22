# 概念と責務ごとのまとまりへの再構成 計画

変更するときの影響を調べたところ、不具合はなかったが、一つの決定を複数のモジュールで書いていた。また、一つの概念を読むのに複数のファイルを渡る必要があった。要求は[requirements-refactoring.md](requirements-refactoring.md)に記録した。

## 決まったこと（2026-10-22、ユーザーと決定）

- **目的**: メンテナンスのしやすさと、人が読んだときの見通しを最優先にする。必要とされる最小の機能はそろっているので、今は構造を整える。
- **フォルダの分け方**: 概念と責務で分ける。機能をまとめて登録するまとめ役は`src/`の直下に置き、概念はフォルダに置く（下の「フォルダの形」）。
- **2つの判定**: 遮断ルール（`block-rules.ts`）とURLでの判定（`block-reasons.ts`）は、技術ごとに分けたまま`blocking/`に並べる。遮断理由ごとの表は、試作で浅い抽象と判定したので作らない（要求仕様書の8章）。
- **一致のテスト**: 生成したURLの組み合わせと設定の8通りで試し、どのルールのIDで決まったかも確かめる。手で書いた一致のテスト（`block-rule.test.ts:246`）は、これに置き換える。
- **設定の表**: 項目名の表を手で書き、型・既定値・検証・全組み合わせ・ファイル名・設定画面の読み書きを導く。項目の間の依存と通知の文言はコードに残す。Valibotは使わない。
- **更新の前後で変えないもの**: 保存の形と遮断ルールのID（1〜9）は、利用者の環境に残るので変えない。中の名前は自由に変えてよい。ビルドが出力するファイルの名前も変えない（`blocked.html`など）。ソースの名前と出力の名前の対応は、`scripts/build.ts`に表として置く。
- **ファイル名の末尾**: 入口は`*.entry.ts`、ChromeのAPIを包むファイルは`*.chrome.ts`、DOMを扱うファイルは`*.dom.ts`。境界の規則R1〜R3は`.oxlintrc.json`で守り、取り決めを`docs/decisions.md`に書く。R1はテストのファイルと`test-support/`にもかける。テストのファイルと`test-support/`はR2の対象外にし、R3はe2eとscriptsを含むすべての`.ts`ファイルにかける（Codexのレビューを受けて決定）。
- **名前**: コードの名前だけをCONTEXT.mdの用語に合わせる。警告ページは`warning-page`、`core/content-script.ts`は`settings-script.ts`にする。`protection`は実装の名前として残す。
- **ユニットテストを足さないもの**: `settings-storage`と`localize`。網羅率の計測から外し、E2Eで確かめる今の方針を保つ。
- **確かめ方**: コミットごとに`pnpm run check`を流す。E2Eはheadlessで流し、流す前に起動回数を伝える。
- **記録**: 保存の形と遮断ルールのIDを変えないことはADR-0005に、フォルダの方針はP5に、ファイル名の末尾とlintの取り決めはP6に書く。画面の文言・README・CONTEXT.mdの言葉をそろえることは、`docs/decisions.md`の「将来の目標」に書く。
- **単位**: ブランチは1本、プルリクエストは1つ。コミットは下の7つに分ける。CONTEXT.mdの編集は、別のプルリクエストにする。
- **試作のworktree**: 実装が終わるまで残し、終わったら消してよいかを確かめる。

## フォルダの形

```
src/
  background.entry.ts          まとめ役。部品をつなぐだけ（今のbackground.ts）
  protection.ts                まとめ役。遮断ルールとcontent scriptの登録、バッジ（今のcore/protection.ts）
  blocking/                    共有: 遮断理由と遮断ルール
    block-rules.ts             今のcore/block-rule.ts
    block-reasons.ts           今のcore/block-reasons.ts
    ip-address.ts              今のcore/ip-address.ts
    password-mask.ts           maskPassword、MASKED_PASSWORD、BLOCKED_PROTOCOLS（今のcore/blocked-url.tsから分ける）
  settings/                    共有: 設定
    settings.ts                項目の表、型、既定値、検証
    settings-storage.chrome.ts
    options.entry.ts、options.html、options.css
  warning-page/
    warning-page.entry.ts      今のblocked.ts
    warning-page.html、warning-page.css（出力の名前はblocked.html、blocked.css）
    blocked-url.ts             parseBlockedUrlだけを残す
    host-description.ts
  service-worker-navigation/   ADR-0004
    content.entry.ts
    settings-script.ts         今のcore/content-script.ts
    warning-target.ts
    redirect-tracking.ts
  i18n/                        共有
    localize.dom.ts
  test-support/
    warning-page.ts            テスト用の警告ページのURL
    fake-browser.ts、fake-start-store.ts、redirect-target.ts
```

テストのファイルは、今と同じく、テストする対象の隣に置く。

## 作業

ブランチ: `refactor/structure-by-concept`

どのコミットでも振る舞いは変えず、`direnv exec . pnpm run check`が通る状態を保つ。

### Phase 0: 基準を記録する

- [x] `main`で次の値を書き出し、scratchpadに置く
  - `buildBlockRules`の出力（設定の8通り）
  - `settingsScripts`の出力（パスと中身）
  - `pnpm run build`の後の`dist/`のファイルの一覧と、`dist/manifest.json`
- 完了の基準: 3つのファイルがscratchpadにあり、Phase 8で同じ手順で書き出して比べられる

### コミット1: テスト用の警告ページのURLを1か所にまとめる（`refactor`）

- [x] 新規: `src/core/test-support/warning-page.ts`
- [x] 変更: `fake-browser.ts`、`redirect-target.ts`、`warning-target.test.ts`、`redirect-tracking.test.ts`が、新しいファイルから読み込む
- 完了の基準: `"chrome-extension://abcdefghijklmnop/blocked.html"`が`src/`の中に1回だけ現れ、`check`が通る
- 含まないもの: フォルダの移動（コミット4）

### コミット2: 一致のテストを強化する（`test`）

- [x] 変更: `test-support/redirect-target.ts`に、どのルールのIDで決まったかを返す`decideByRules`を足す。`redirectTarget`は、`decideByRules`を呼んで飛ばす先だけを返す関数にする
- [x] 新規: `src/core/block-rule-agreement.test.ts`。生成したURLの組み合わせを、設定の8通りで試す。遮断するかどうか、ルールのID、パスワードが漏れないことを確かめる
- [x] 削除: `block-rule.test.ts`の、手で書いた一致のテスト（246行目から）
- 下書き: `.claude/worktrees/agent-a8b1fe88910eb31bc`の差分を元にし、読み直してから取り込む
- 完了の基準: `check`が通る。ルール8の番号を一時的に変えると、新しいテストが落ちる（確かめたら戻す）
- 含まないもの: 本番のコードの変更

### コミット3: 設定の項目の表を作る（`refactor`）

- [x] 変更: `core/settings.ts`に項目名の表を置き、型・既定値・検証を表から導く。位置に頼る分割代入をやめる
- [x] 変更: `core/content-script.ts`の全組み合わせとファイル名の数字を、表から導く
- [x] 変更: `options.ts`の`SETTING_NAMES`と`readForm`を、表から導く
- [x] 変更なし: `protection.ts`の`findNotices`（通知の文言と、項目の間の依存はコードに残す）
- 完了の基準: `check`が通る。`settingsScripts`の出力がPhase 0の記録と同じ。設定の項目の一覧を書く場所が、表と既定値だけになる
- 含まないもの: 項目名の変更（C-2）

### コミット4: フォルダを概念ごとに移す（`refactor`）

- [x] `git mv`で、上の「フォルダの形」のフォルダへ移す。この時点ではファイル名を変えない
- [x] `core/blocked-url.ts`を、`blocking/password-mask.ts`と`warning-page/blocked-url.ts`に分ける
- [x] 読み込みのパスを直す。`src/`、`e2e/`、`scripts/build.ts`が対象
- [x] `scripts/build.ts`の入口と、html・cssを写す元のパスを直す
- [x] `vitest.config.ts`の網羅率の除外のパスを直す
- 完了の基準: `check`が通る。`dist/`のファイルの一覧と`manifest.json`が、Phase 0の記録と同じ
- 含まないもの: 名前の変更（コミット5）

### コミット5: 名前を用語に合わせ、ファイル名の末尾を付ける（`refactor`）

- [x] 入口を`*.entry.ts`に、ChromeのAPIを包むファイルを`*.chrome.ts`に、DOMを扱うファイルを`*.dom.ts`にする
- [x] `blocked.ts`・`blocked.html`・`blocked.css`のソースの名前を`warning-page.*`にする。出力の名前は`blocked.*`のまま、`scripts/build.ts`の対応の表で決める
- [x] `content-script.ts`を`settings-script.ts`に、`block-rule.ts`を`block-rules.ts`にする
- [x] 警告ページを指す識別子を`warningPage`にそろえる（`WARNING_PAGE_URL`、`warningPageUrl`、`WARNING_PAGE`）
- [x] e2eの遮断理由の値（`e2e/support/attacker-site.ts`の`"idn" | "ip" | "userinfo"`）を、`src`の`BlockReason`の値にそろえる
- [x] `vitest.config.ts`の網羅率の除外を、末尾のglob（`*.entry.ts`など）で書く
- 完了の基準: `check`が通る。`dist/`の一覧と`manifest.json`がPhase 0の記録と同じ
- 含まないもの: 画面の文言、README、CONTEXT.md、言語ファイルのキー

### コミット6: 境界の規則をoxlintに加える（`chore`）

- [x] 変更: `.oxlintrc.json`
  - R1: `src/**/*.ts`から、末尾（`*.entry.ts`、`*.chrome.ts`、`*.dom.ts`）を持つファイルだけを`excludeFiles`で外し、`no-restricted-globals`をかける。`chrome`、`document`、`location`を対象にし、`checkGlobalObject`を使う。テストのファイルと`test-support/`も対象に含める（今のテストは、実行時にこの3つを使っていない。2026-10-22に検索で確かめた）
  - R3: 基底の`rules`に`no-restricted-imports`を置き、`*.entry.ts`を禁じる。`src/`の直下、テスト、`e2e/`、`scripts/`を含む、すべての`.ts`ファイルにかかる
  - R2: フォルダごとの`overrides`に`no-restricted-imports`をかけ、共有のフォルダ（`blocking/`、`settings/`、`i18n/`）以外の兄弟を禁じる。`excludeFiles`でテスト（`*.test.ts`）を外す。`test-support/`はフォルダごとの`overrides`の対象にしない。`overrides`の設定は基底の規則と合わさらず置き換わると見込んで、各R2の規則にもR3のパターンを書き写す（`overrides`同士で置き換わることは、試しのファイルで確かめた。基底の規則との間でも同じかは、下のR3の試しで確かめる）
- 完了の基準: 今のコードへの指摘が0件。次の試しのファイルを置くと、それぞれ指摘が出る（確かめたら消す）
  - R1: 純粋なファイルで`chrome.runtime.id`を使う。テストのファイルで`document.title`を使う
  - R2: `warning-page/`のファイルから`service-worker-navigation/`を読み込む
  - R3: `src/`の直下のファイル、`warning-page/`のファイル、`e2e/`のファイルから、それぞれ`*.entry.ts`を読み込む
- 指摘が出ないことも確かめる: テストのファイルと`test-support/`が、テストする対象のフォルダを読み込む場合
- 含まないもの: dependency-cruiserの導入

### コミット7: 取り決めを記録する（`docs`）

- [x] 新規: `docs/adr/0005-…md`（保存の形と遮断ルールのIDを固定する）
- [x] 変更: `docs/decisions.md`にP5（フォルダの方針）、P6（ファイル名の末尾とlintの規則）、「将来の目標」の節を足す
- [x] 日本語の部分はnatural-japaneseを通し、全角と半角の間に空白がないかを正規表現で確かめる
- 完了の基準: `format:check`が通る。要求仕様書の7章の4項目がすべて書かれている

### Phase 8: 確認

- [x] Phase 0と同じ手順で書き出し、AC-1〜AC-3を比べる
- [x] E2Eを流す前に、ブラウザを起動する回数と、ウィンドウが出ないことを伝える。了承を得てから`direnv exec . pnpm run test:e2e`を流す
- [x] code-reviewerエージェントで差分を点検する
- [x] 下の「要求とコミットの対応」を埋める
- [x] プルリクエストを作る（#16、2026-10-22にマージ）

### Phase 9: 後片付け

- [x] 試作のworktree2つ（`agent-a91ed051770ec119d`、`agent-a8b1fe88910eb31bc`）とそのブランチを消してよいか、ユーザーに確かめる

### 別のプルリクエスト: 用語集を直す

- [x] CONTEXT.mdに「埋め込まれた文書」と「Service Workerが応答する遷移」を足す（#18）
- [x] 避けるべき語「拒否」（:44）を言い換える（#18）
- [x] 全角と半角の間の空白をなくす（#18）
- [x] 画面の言葉（「止める」など）と用語集の言葉の対応を、用語集に書くかを決める。書かないと決めた（2026-10-22）。用語集は概念を定義する場所で、画面の文言との対応表を置くと実装に近い情報が混ざる。言葉をそろえるときに画面を用語集に合わせれば、対応表は要らない（`docs/decisions.md`の「将来の目標」）

## 途中で決める必要があること

- コミット4で、e2eから`src/`を読み込むパスが増えすぎて読みにくくなったら、まとめて読み込む入口のファイルを`e2e/support/`に置くか
- コミット5で、言語ファイルのキー（`headingUserinfo`など）がCONTEXT.mdの用語とずれていても変えない。画面に関わるので、将来の目標で扱う。変える必要が出たら、ユーザーに聞く

## 要求とコミットの対応

Phase 8で埋める。

| 要求 | コミット | 確かめたもの                                                                                                                                                                            |
| ---- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SR-1 | 4        | `src/`の直下は`background.entry.ts`と`protection.ts`（とそのテスト）だけ。`dist/`の一覧と`manifest.json`がPhase 0と同じ                                                                 |
| SR-2 | 4        | `blocking/`に`block-rules.ts`と`block-reasons.ts`が並ぶ。遮断理由ごとの表は作っていない                                                                                                 |
| SR-3 | 3        | `settingsScripts`と`buildBlockRules`の出力がPhase 0と1バイトも違わない。項目の一覧は`SETTING_NAMES`と`DEFAULT_SETTINGS`だけ（AC-6）                                                     |
| SR-4 | 5        | 入口4つが`*.entry.ts`、`settings-storage.chrome.ts`、`localize.dom.ts`。網羅率の除外は末尾のglob                                                                                        |
| SR-5 | 6        | 今のコードへの指摘が0件。試しのファイルで、R1（`globalThis.chrome`とテストの`document`を含む）、R2、R3（`src/`の直下・フォルダ・`e2e/`）に指摘が出て、テストと`test-support/`には出ない |
| SR-6 | 5        | e2eの`BlockReason`を`src`から読み込み、型検査で値の食い違いがないことを確かめた。`blockedPageKeys`を`warningPageKeys`にした                                                             |
| SR-7 | 1        | `"chrome-extension://abcdefghijklmnop/blocked.html"`が`src/test-support/warning-page.ts`に1回だけ現れる                                                                                 |
| SR-8 | 2        | 4,000通り以上のURLを設定の8通りで試す。ルール8の番号を変えると落ちる。パスワードのルールの`\2`を消すと落ちる（レビューの指摘を受けて、飛ばす先も比べるようにした）                      |
| SR-9 | 7        | ADR-0005、P5、P6、「将来の目標」を書いた。ADRはnatural-japaneseのlintで0件                                                                                                              |

## 振り返り

- コミットごとに`pnpm run check`が通ることを、`git rebase --exec`で7つすべて確かめた。
- E2E（macOS、headless）: 138件が通り、3件は飛ばした（`language.spec.ts`はLinuxでだけ動く。`main`と同じ）。
- 計画とずれた点:
  - `src/locales.test.ts`は計画のフォルダの形になかったので、`i18n/locales.test.ts`に移した。
  - コミット2の試しでは、ルール8の番号を変えると、新しいテストのほかに`protection.test.ts`も落ちた（登録するIDの一覧を確かめているため）。要求仕様書の8章は試作の結果として「新しいテストだけが見つけた」と書いていたので、実装のブランチでの結果を書き足した。
  - レビューの指摘を受けて、一致のテストで飛ばす先も比べるようにした。警告ページの入口のエラーの文言は、出力の名前（`blocked.html`）に戻した。
  - コミット3で、`content.js`が設定の表を読み込むようになり、3.7kbから4.1kbに増えた。AC-3はファイルの一覧と`manifest.json`だけを比べるので、基準は満たしている。
- `README.md`の162〜164行の表が古いパス（`src/blocked.ts`など）を書いていた。READMEは今回の対象外にしたので、マージ後の別のPRで直した。
