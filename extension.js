const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { translateToArabic } = require("./aiTranslator");

// =========================================================================
// 🎯 1. الإعدادات والمسارات الموحدة (عدلي هنا فقط)
// =========================================================================

// مسار المشروع الخاص بكِ (ضع مسار مشروعك كاملاً هنا)
// مثال على ويندوز: "C:/Users/name/Projects/my-app"
const PROJECT_ROOT_PATH = "C:\\Users\\mikik\\OneDrive\\Desktop\\Ascpius-Team-website-";

// مسارات ملفات اللغات بالنسبة لمشروعك (أو مسارات مطلقة إذا أردتِ)
const ENGLISH_FILE_PATH = "src\\i18n\\locales\\en.json";
const ARABIC_FILE_PATH = "src\\i18n\\locales\\ar.json";

// البادئة (Prefix) لمفاتيح الترجمة
//const PREFIX = "admin.dashboard";
const PREFIX = "";

const INDENT_SPACES = 2;


// =========================================================================
// 🛠️ 2. دوال مساعدة موحدة لإدارة الملفات والبيانات
// =========================================================================

/**
 * الاختصار: Ctrl + Shift + S
 * - يترجم النص بالذكاء الاصطناعي
 * - يضيفه إلى ملفات en.json و ar.json
 * - يستبدل النص المحدد بـ "key" مباشرة (أو 'key') بدون {t()}
 * - يفتح ar.json ويضع المؤشر على القيمة للمراجعة
 */
async function translateSelectionRawKey(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("Translation Helper: No active editor.");
        return;
    }

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections
        .map(s => document.getText(s))
        .filter(t => t.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage("حدد كلمة أو جملة أولاً ثم اضغط الاختصار.");
        return;
    }

    const apiKey = await context.secrets.get("translationHelper.openaiApiKey");
    if (!apiKey) {
        const result = await vscode.window.showWarningMessage("ما فيه OpenAI API Key محفوظ.", "إضافة المفتاح");
        if (result === "إضافة المفتاح") await setOpenAIKey(context);
        return;
    }

    let files;
    try {
        files = getLocaleFilesData();
    } catch (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }

    const { englishPath, arabicPath, englishData, arabicData } = files;

    const uniqueEntries = [];
    const seenKeys = new Set();

    for (const originalText of selectedTexts) {
        // تنظيف النص في حال تم تحديده مع علامات تنصيص
        const cleanText = originalText.replace(/^['"]|['"]$/g, "").trim();
        const key = createKey(cleanText);

        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEntries.push({ originalText: cleanText, key });
        }
    }

    // التحقق من تكرار المفتاح
    const existing = uniqueEntries.filter(
        e => Object.prototype.hasOwnProperty.call(englishData, e.key) ||
            Object.prototype.hasOwnProperty.call(arabicData, e.key)
    );

    if (existing.length > 0) {
        const details = existing.map(e => e.key).join("\n");
        const result = await vscode.window.showWarningMessage(
            `المفتاح موجود مسبقاً:\n\n${details}\n\nلن يتم تكراره.`,
            "إلغاء",
            "استخدام الموجود"
        );
        if (result !== "استخدام الموجود") return;
    }

    // الترجمة بالذكاء الاصطناعي
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Translation Helper: جاري الترجمة بالذكاء الاصطناعي...",
            cancellable: false
        },
        async () => {
            for (const entry of uniqueEntries) {
                if (!Object.prototype.hasOwnProperty.call(englishData, entry.key)) {
                    englishData[entry.key] = entry.originalText;
                }
                if (!Object.prototype.hasOwnProperty.call(arabicData, entry.key)) {
                    const translation = await translateToArabic(apiKey, entry.originalText);
                    arabicData[entry.key] = translation;
                }
            }
        }
    );

    // الحفظ في ملفات الترجمة
    try {
        saveLocaleFiles(englishPath, englishData, arabicPath, arabicData);
    } catch (err) {
        vscode.window.showErrorMessage(`حدث خطأ أثناء حفظ ملفات الترجمة:\n${err.message}`);
        return;
    }

    // استبدال النص المحدد بـ "key" مباشرة (بدون t وبدون أقواس)
    const edit = new vscode.WorkspaceEdit();
    for (const selection of selections) {
        if (selection.isEmpty) continue;
        const text = document.getText(selection).replace(/^['"]|['"]$/g, "").trim();
        const key = createKey(text);

        // استبدال بـ "key"
        edit.replace(document.uri, selection, `"${key}"`);
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
        vscode.window.showErrorMessage("تعذر تعديل الملف الحالي.");
        return;
    }
    await document.save();

    // فتح ar.json وتحديد مكان القيمة
    const arabicDocument = await vscode.workspace.openTextDocument(arabicPath);
    const arabicEditor = await vscode.window.showTextDocument(arabicDocument, vscode.ViewColumn.Beside);

    const firstEntry = uniqueEntries[0];
    if (firstEntry) {
        const position = findJsonValuePosition(arabicDocument, firstEntry.key);
        if (position) {
            arabicEditor.selection = new vscode.Selection(position, position);
            arabicEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }

    vscode.window.showInformationMessage(`تمت إضافة وترجمة ${uniqueEntries.length} مفتاح.`);
}


/**
 * تحويل المسار إلى مسار مطلق بناءً على PROJECT_ROOT_PATH
 */
function getAbsoluteFilePath(filePath) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    return path.join(PROJECT_ROOT_PATH, filePath);
}

/**
 * قراءة ملفي الترجمة من المسارات المحددة
 */
function getLocaleFilesData() {
    const englishPath = getAbsoluteFilePath(ENGLISH_FILE_PATH);
    const arabicPath = getAbsoluteFilePath(ARABIC_FILE_PATH);

    if (!fs.existsSync(englishPath)) {
        throw new Error(`ملف اللغة الإنجليزية غير موجود في المسار:\n${englishPath}`);
    }

    if (!fs.existsSync(arabicPath)) {
        throw new Error(`ملف اللغة العربية غير موجود في المسار:\n${arabicPath}`);
    }

    let englishData;
    let arabicData;

    try {
        englishData = JSON.parse(fs.readFileSync(englishPath, "utf8"));
    } catch (err) {
        throw new Error(`تعذر قراءة ملف en.json، تأكد من صحة التنسيق:\n${err.message}`);
    }

    try {
        arabicData = JSON.parse(fs.readFileSync(arabicPath, "utf8"));
    } catch (err) {
        throw new Error(`تعذر قراءة ملف ar.json، تأكد من صحة التنسيق:\n${err.message}`);
    }

    return {
        englishPath,
        arabicPath,
        englishData,
        arabicData
    };
}

/**
 * حفظ ملفي الترجمة
 */
function saveLocaleFiles(englishPath, englishData, arabicPath, arabicData) {
    fs.writeFileSync(
        englishPath,
        JSON.stringify(englishData, null, INDENT_SPACES) + "\n",
        "utf8"
    );
    fs.writeFileSync(
        arabicPath,
        JSON.stringify(arabicData, null, INDENT_SPACES) + "\n",
        "utf8"
    );
}

/**
 * إنشاء مفتاح الترجمة مع الـ PREFIX
 */
function createKey(text) {
    let key = text.trim().replace(/\s+/g, "_");
    if (PREFIX && PREFIX.trim() !== "") {
        key = PREFIX.trim() + "." + key;
    }
    return key;
}

/**
 * العثور على موضع بداية القيمة في ملف الـ JSON لوضع المؤشر عنده للمراجعة
 */
function findJsonValuePosition(document, key) {
    const text = document.getText();
    const escapedKey = escapeRegExp(key);
    const regex = new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]*)"`);
    const match = regex.exec(text);

    if (!match) {
        return null;
    }

    const valueStart = match.index + match[0].indexOf('"', match[0].indexOf(':')) + 1;
    return document.positionAt(valueStart);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseQuotedEjsText(text) {
    const trimmed = text.trim();
    if (trimmed.length < 2) return null;

    const firstChar = trimmed[0];
    const lastChar = trimmed[trimmed.length - 1];

    if ((firstChar === "'" && lastChar === "'") || (firstChar === '"' && lastChar === '"')) {
        const innerText = trimmed.slice(1, -1);
        if (!innerText.trim()) return null;
        return { text: innerText, quote: firstChar };
    }
    return null;
}


// =========================================================================
// 🚀 3. الأوامر التنفيذية (Commands)
// =========================================================================

/**
 * الاختصار: Ctrl + Shift + X
 * - يترجم النص بالذكاء الاصطناعي
 * - يضيفه إلى ملفات en.json و ar.json
 * - يستبدل النص المحدد بـ {t("key")}
 * - يفتح ar.json ويضع المؤشر على القيمة العربية للمراجعة
 */
async function translateSelectionWithReact(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("Translation Helper: No active editor.");
        return;
    }

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections
        .map(s => document.getText(s))
        .filter(t => t.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage("حدد كلمة أو جملة أولاً ثم اضغط الاختصار.");
        return;
    }

    const apiKey = await context.secrets.get("translationHelper.openaiApiKey");
    if (!apiKey) {
        const result = await vscode.window.showWarningMessage("ما فيه OpenAI API Key محفوظ.", "إضافة المفتاح");
        if (result === "إضافة المفتاح") await setOpenAIKey(context);
        return;
    }

    let files;
    try {
        files = getLocaleFilesData();
    } catch (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }

    const { englishPath, arabicPath, englishData, arabicData } = files;

    const uniqueEntries = [];
    const seenKeys = new Set();

    for (const originalText of selectedTexts) {
        const key = createKey(originalText);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEntries.push({ originalText, key });
        }
    }

    // التحقق إذا كان المفتاح موجوداً مسبقاً
    const existing = uniqueEntries.filter(
        e => Object.prototype.hasOwnProperty.call(englishData, e.key) ||
            Object.prototype.hasOwnProperty.call(arabicData, e.key)
    );

    if (existing.length > 0) {
        const details = existing.map(e => e.key).join("\n");
        const result = await vscode.window.showWarningMessage(
            `المفتاح موجود مسبقاً:\n\n${details}\n\nلن يتم تكراره.`,
            "إلغاء",
            "استخدام الموجود"
        );
        if (result !== "استخدام الموجود") return;
    }

    // الترجمة بالذكاء الاصطناعي
    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Translation Helper: جاري الترجمة بالذكاء الاصطناعي...",
            cancellable: false
        },
        async () => {
            for (const entry of uniqueEntries) {
                if (!Object.prototype.hasOwnProperty.call(englishData, entry.key)) {
                    englishData[entry.key] = entry.originalText;
                }
                if (!Object.prototype.hasOwnProperty.call(arabicData, entry.key)) {
                    const translation = await translateToArabic(apiKey, entry.originalText);
                    arabicData[entry.key] = translation;
                }
            }
        }
    );

    // الحفظ
    try {
        saveLocaleFiles(englishPath, englishData, arabicPath, arabicData);
    } catch (err) {
        vscode.window.showErrorMessage(`حدث خطأ أثناء حفظ ملفات الترجمة:\n${err.message}`);
        return;
    }

    // استبدال النص بـ {t("key")}
    const edit = new vscode.WorkspaceEdit();
    for (const selection of selections) {
        if (selection.isEmpty) continue;
        const originalText = document.getText(selection);
        const key = createKey(originalText);
        edit.replace(document.uri, selection, `{t("${key}")}`);
    }

    const applied = await vscode.workspace.applyEdit(edit);
    if (!applied) {
        vscode.window.showErrorMessage("تعذر تعديل الملف الحالي.");
        return;
    }
    await document.save();

    // فتح ar.json بجانب المحرر ووضع المؤشر على القيمة
    const arabicDocument = await vscode.workspace.openTextDocument(arabicPath);
    const arabicEditor = await vscode.window.showTextDocument(arabicDocument, vscode.ViewColumn.Beside);

    const firstEntry = uniqueEntries[0];
    if (firstEntry) {
        const position = findJsonValuePosition(arabicDocument, firstEntry.key);
        if (position) {
            arabicEditor.selection = new vscode.Selection(position, position);
            arabicEditor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
    }

    vscode.window.showInformationMessage(`تمت ترجمة وإضافة ${uniqueEntries.length} مفتاح.`);
}


/**
 * أوامر EJS السابقة تم تحديثها لتعتمد على نفس المسارات الموحدة
 */
async function translateEjsWithAI(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections.map(s => document.getText(s)).filter(t => t.length > 0);

    const entries = [];
    for (const text of selectedTexts) {
        const parsed = parseQuotedEjsText(text);
        if (!parsed) {
            vscode.window.showWarningMessage("حدد النص كاملاً مع علامات التنصيص مثل 'Text' أو \"Text\".");
            return;
        }
        entries.push(parsed);
    }

    const apiKey = await context.secrets.get("translationHelper.openaiApiKey");
    if (!apiKey) {
        await setOpenAIKey(context);
        return;
    }

    let files;
    try {
        files = getLocaleFilesData();
    } catch (err) {
        vscode.window.showErrorMessage(err.message);
        return;
    }

    const { englishPath, arabicPath, englishData, arabicData } = files;

    const uniqueEntries = [];
    const seenKeys = new Set();
    for (const entry of entries) {
        const key = createKey(entry.text);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEntries.push({ ...entry, key });
        }
    }

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Translation Helper: جاري الترجمة بالذكاء الاصطناعي...",
            cancellable: false
        },
        async () => {
            for (const entry of uniqueEntries) {
                if (!englishData[entry.key]) englishData[entry.key] = entry.text;
                if (!arabicData[entry.key]) {
                    arabicData[entry.key] = await translateToArabic(apiKey, entry.text);
                }
            }
        }
    );

    saveLocaleFiles(englishPath, englishData, arabicPath, arabicData);

    const edit = new vscode.WorkspaceEdit();
    for (let i = 0; i < selections.length; i++) {
        const selection = selections[i];
        if (selection.isEmpty) continue;
        const entry = entries[i];
        const key = createKey(entry.text);
        edit.replace(document.uri, selection, `__(${entry.quote}${key}${entry.quote})`);
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();
    vscode.window.showInformationMessage(`تمت ترجمة ${uniqueEntries.length} نصوص لـ EJS.`);
}

async function setOpenAIKey(context) {
    const apiKey = await vscode.window.showInputBox({
        prompt: "أدخل OpenAI API Key",
        password: true,
        ignoreFocusOut: true,
        placeHolder: "sk-..."
    });

    if (!apiKey) return;

    await context.secrets.store("translationHelper.openaiApiKey", apiKey.trim());
    vscode.window.showInformationMessage("تم حفظ OpenAI API Key بشكل آمن في VS Code.");
}

function activate(context) {
    context.subscriptions.push(
        vscode.commands.registerCommand("translationHelper.translateSelection", () => translateSelectionWithReact(context)),
        vscode.commands.registerCommand("translationHelper.translateEjsWithAI", () => translateEjsWithAI(context)),
        vscode.commands.registerCommand("translationHelper.setApiKey", () => setOpenAIKey(context)),
        vscode.commands.registerCommand("translationHelper.translateSelectionRawKey", () => translateSelectionRawKey(context))
    );
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
};