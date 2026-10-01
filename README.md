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

## 仕様

[公式ポリシー資料](https://learn.microsoft.com/azure/api-management/llm-token-limit-policy)に、対応プラン、推定、ストリーミング、並列実行の注意点があります。期間内クォータによる403と、トークンレート制限による429は分けて記録します。

日本語の推敲・検査に使うのは、[yomiyasu](https://github.com/nanaism/yomiyasu)の固定版`23e16634357f3361cf3ea1cacf2684aa3d9f182f`です。
