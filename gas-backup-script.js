// ============================================================
// Google Apps Script - 売上計画ダッシュボード 自動バックアップ
// ============================================================
// 使い方:
// 1. Google Drive にバックアップ用フォルダを作成
// 2. フォルダを開いてURLからフォルダIDを取得
//    例: https://drive.google.com/drive/folders/XXXXXXXX → XXXXXXXX がID
// 3. 下の FOLDER_ID にそのIDを設定
// 4. https://script.google.com にアクセス
// 5. 新しいプロジェクトを作成し、このコードを貼り付け
// 6. 「デプロイ」→「新しいデプロイ」→「ウェブアプリ」を選択
//    - 実行ユーザー: 自分
//    - アクセスできるユーザー: 全員
// 7. デプロイ後に表示されるURLをコピーし、ダッシュボードの設定に貼り付け
//
// ※ 復元機能を使うには、GASを再デプロイしてください
// ============================================================

const FOLDER_ID = 'ここにフォルダIDを貼り付け'; // ← Driveフォルダのidに置き換え
const MAX_BACKUP_DAYS = 30; // 30日以上前のバックアップを自動削除

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const folder = DriveApp.getFolderById(FOLDER_ID);

    // ファイル名: バックアップ_YYYY-MM-DD_HHmmss.json
    const now = new Date();
    const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
    const fileName = 'バックアップ_' + dateStr + '.json';

    // JSONファイルとして保存
    const content = JSON.stringify(data, null, 2);
    folder.createFile(fileName, content, MimeType.PLAIN_TEXT);

    // 古いバックアップを削除
    cleanOldBackups(folder);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        message: 'バックアップを保存しました: ' + fileName,
        timestamp: now.toISOString()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: 'エラー: ' + error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'latest') {
    return getLatestBackup();
  }

  return ContentService
    .createTextOutput(JSON.stringify({
      success: true,
      message: '売上計画バックアップAPIは正常に動作しています'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getLatestBackup() {
  try {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var files = folder.getFiles();
    var latest = null;
    var latestDate = null;

    while (files.hasNext()) {
      var file = files.next();
      var created = file.getDateCreated();
      if (!latestDate || created > latestDate) {
        latestDate = created;
        latest = file;
      }
    }

    if (!latest) {
      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          message: 'バックアップファイルが見つかりません（フォルダID: ' + FOLDER_ID + '）'
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var content = latest.getBlob().getDataAsString();
    var data = JSON.parse(content);

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        fileName: latest.getName(),
        createdAt: latestDate.toISOString(),
        data: data
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        message: '復元エラー: ' + error.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function cleanOldBackups(folder) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - MAX_BACKUP_DAYS);

  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (file.getDateCreated() < cutoff) {
      file.setTrashed(true);
    }
  }
}
