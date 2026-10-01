# Azure AI Gatewayのトークン上限を検証する

[English](README.en.md)

Azure API Managementの`llm-token-limit`を使い、設定した上限と実際のトークン消費量を比較します。対象はDeveloperプランの単一ゲートウェイです。通常応答の事前推定ON／OFFと、ストリーミングを並列数1・4・8で試します。

現在は検証環境を準備しています。測定結果はまだありません。公式仕様では、並列実行で上限を一時的に超える場合があります。この実験では超過するという結論を先に決めず、成立した試行と失敗した試行を残します。

## 公開範囲

公開するのは再現用コードと、匿名化した検証結果です。記事本文、生ログ、Azureの識別情報、認証情報は公開対象外とします。

## 費用と削除

APIM Developerには、リクエストがなくても稼働料が発生します。Azure OpenAIの推論料金も必要です。料金と利用枠を確認してから、専用リソースグループに作成してください。検証後は専用リソースだけを削除します。

```powershell
npm ci
npm run typecheck
npm test
az bicep build --file infra\main.bicep
```

パラメータと生ログは、このリポジトリの外に保存します。GitHub Actionsではクラウドへのデプロイや有料の推論を実行しません。

## 検証プログラム

Node.js 24、PowerShell 7、Azure CLIを使います。`$private`にはリポジトリ外の保存先を、`$subscription`には作成先のサブスクIDを指定してください。`$suffix`には未使用の接尾辞を入れます。

```powershell
.\scripts\prepare-lab.ps1 -SubscriptionId $subscription -PrivateRoot $private -Suffix $suffix
.\scripts\deploy-lab.ps1 -PrivateRoot $private
```

デプロイが成功したら、クライアント設定を非公開の保存先に書き出します。ポリシー更新用のスクリプトは`update-policies.ps1`です。APIM本体は再作成しません。

```powershell
.\scripts\export-client-config.ps1 -PrivateRoot $private
npm run build
node dist\src\run.js $private pilot
```

予備実験は最大32リクエストです。使用量、ストリームの終了、拒否元を確認し、クォータ値を固定してから本実験へ進みます。通常応答の推定ON／OFFとストリーミングを比較し、ストリーミングの推定ON／OFFを別条件にはしません。

本実験はコミット済みで変更のない作業ツリーから実行します。通信の自動リトライはありません。使用量が欠けた場合やモデル側のエラーは記録して停止し、成功した試行に混ぜない設計です。

```powershell
node dist\src\run.js $private control
node dist\src\run.js $private quota
node dist\src\run.js $private rate
node dist\src\report.js $private $controlRunId $quotaRunId $rateRunId
```

対照18試行、主実験45試行、レート制限9試行を予定しています。各試行は最大64リクエスト、並列数は最大8です。送信前に予算を予約し、累計4,000リクエスト、推定200万トークン、見込み1万円のいずれかを超える実行を止めます。

生の応答とヘッダーは非公開側に残します。公開する形式はJSONL、CSV、SVGです。集計時に許可した項目だけを`results`へ書き出します。403や429だけではAPIMによる拒否と判定しません。ポリシーの識別子と実行位置を確認できた拒否だけを、バックエンド消費0として扱います。

カウンターキーをクライアントから渡すのは、試行を分けるための検証用設定です。本番の利用者別制限には流用しないでください。本番では認証済みの利用者情報などからキーを決めます。

記録を保存したら、専用グループ名を明示して削除します。

```powershell
.\scripts\remove-lab.ps1 -PrivateRoot $private -ConfirmResourceGroup $dedicatedGroupName
```

## 仕様

対応プラン、推定、ストリーミング、並列実行の仕様は[公式ポリシー資料](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy)を参照してください。期間内クォータによる403と、トークンレート制限による429は分けて記録します。

日本語の推敲・検査に使うのは、[yomiyasu](https://github.com/nanaism/yomiyasu)の固定版`23e16634357f3361cf3ea1cacf2684aa3d9f182f`です。
