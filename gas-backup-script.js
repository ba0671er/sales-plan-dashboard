// ============================================================
// Google Apps Script - 売上計画ダッシュボード 自動バックアップ
// ============================================================
// FOLDER_ID: Google DriveのバックアップフォルダID
// ============================================================

const FOLDER_ID = '1CQpSU5KsnoPbUqwmeFSpyxFHrZz-LEeS';
const MAX_BACKUP_DAYS = 30;

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const now = new Date();
    const dateStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd_HHmmss');
    const fileName = 'バックアップ_' + dateStr + '.json';
    const content = JSON.stringify(data, null, 2);
    folder.createFile(fileName, content, MimeType.PLAIN_TEXT);
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

  if (action === 'list') {
    return listBackups();
  }
  if (action === 'get') {
    var fileName = (e && e.parameter && e.parameter.file) || '';
    return getBackupByName(fileName);
  }
  return getLatestBackup();
}

function listBackups() {
  try {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var files = folder.getFiles();
    var list = [];
    while (files.hasNext()) {
      var file = files.next();
      var size = file.getSize();
      list.push({
        name: file.getName(),
        created: file.getDateCreated().toISOString(),
        size: size
      });
    }
    list.sort(function(a, b) { return b.created.localeCompare(a.created); });
    return ContentService
      .createTextOutput(JSON.stringify({ success: true, files: list }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function getBackupByName(fileName) {
  try {
    var folder = DriveApp.getFolderById(FOLDER_ID);
    var files = folder.getFilesByName(fileName);
    if (!files.hasNext()) {
      return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: 'ファイルが見つかりません: ' + fileName }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    var file = files.next();
    var content = file.getBlob().getDataAsString();
    var data = JSON.parse(content);
    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        fileName: file.getName(),
        createdAt: file.getDateCreated().toISOString(),
        data: data
      }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, message: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
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
        .createTextOutput(JSON.stringify({ success: false, message: 'バックアップファイルが見つかりません' }))
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
      .createTextOutput(JSON.stringify({ success: false, message: error.message }))
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
