const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const { translateToArabic } = require("./aiTranslator");

// =========================================================================
// 🎯 1. الإعدادات والمسارات الموحدة
// =========================================================================

const PROJECT_ROOT_PATH = "C:\\Users\\mikik\\OneDrive\\Desktop\\Ascpius-Team-website-";
//const PROJECT_ROOT_PATH =  "C:\\Users\\mikik\\OneDrive\\Desktop\\ascpius-admin-project\\ascpius-admin"
const ENGLISH_FILE_PATH = "public\\locales\\en\\en.json";
//const ENGLISH_FILE_PATH = "locales\\en.json";
const ARABIC_FILE_PATH = "public\\locales\\ar\\ar.json";
//const ARABIC_FILE_PATH = "locales\\ar.json";

const PREFIX = "";
const INDENT_SPACES = 2;


// =========================================================================
// 🛠️ 2. دوال مساعدة موحدة لإدارة الملفات والبيانات
// =========================================================================

function getAbsoluteFilePath(filePath) {
    if (path.isAbsolute(filePath)) {
        return filePath;
    }
    return path.join(PROJECT_ROOT_PATH, filePath);
}

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

    return { englishPath, arabicPath, englishData, arabicData };
}

function saveLocaleFiles(englishPath, englishData, arabicPath, arabicData) {
    fs.writeFileSync(englishPath, JSON.stringify(englishData, null, INDENT_SPACES) + "\n", "utf8");
    fs.writeFileSync(arabicPath, JSON.stringify(arabicData, null, INDENT_SPACES) + "\n", "utf8");
}

function createKey(text) {
    let key = text.trim().replace(/\s+/g, "_");
    if (PREFIX && PREFIX.trim() !== "") {
        key = PREFIX.trim() + "." + key;
    }
    return key;
}

function findJsonValuePosition(document, key) {
    const text = document.getText();
    const escapedKey = escapeRegExp(key);
    const regex = new RegExp(`"${escapedKey}"\\s*:\\s*"([^"]*)"`);
    const match = regex.exec(text);

    if (!match) return null;

    const valueStart = match.index + match[0].indexOf('"', match[0].indexOf(':')) + 1;
    return document.positionAt(valueStart);
}

function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * دالة ذكية لفحص علامات التنصيص وتحديد نوعها أو فرض علامة التنصيص الافتراضية
 */
function parseSmartQuotedText(text) {
    const trimmed = text.trim();
    if (trimmed.length >= 2) {
        const firstChar = trimmed[0];
        const lastChar = trimmed[trimmed.length - 1];

        if ((firstChar === "'" && lastChar === "'") || (firstChar === '"' && lastChar === '"')) {
            return {
                cleanText: trimmed.slice(1, -1).trim(),
                quote: firstChar
            };
        }
    }
    return {
        cleanText: trimmed,
        quote: '"' // الافتراضي هو Double Quote
    };
}


// =========================================================================
// 🚀 3. الأوامر التنفيذية (Commands)
// =========================================================================

/**
 * 1. اختصار React الأساسي: Ctrl + Shift + X
 * يستبدل النص بـ {t("key")} بعد ترجمته بالذكاء الاصطناعي
 */
async function translateSelectionWithReact(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections.map(s => document.getText(s)).filter(t => t.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage("حدد كلمة أو جملة أولاً.");
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
        const { cleanText } = parseSmartQuotedText(originalText);
        const key = createKey(cleanText);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEntries.push({ originalText: cleanText, key });
        }
    }

    const existing = uniqueEntries.filter(
        e => Object.prototype.hasOwnProperty.call(englishData, e.key) || Object.prototype.hasOwnProperty.call(arabicData, e.key)
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

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Translation Helper: جاري الترجمة بالذكاء الاصطناعي...",
            cancellable: false
        },
        async () => {
            for (const entry of uniqueEntries) {
                if (!englishData[entry.key]) englishData[entry.key] = entry.originalText;
                if (!arabicData[entry.key]) {
                    arabicData[entry.key] = await translateToArabic(apiKey, entry.originalText);
                }
            }
        }
    );

    saveLocaleFiles(englishPath, englishData, arabicPath, arabicData);

    const edit = new vscode.WorkspaceEdit();
    for (const selection of selections) {
        if (selection.isEmpty) continue;
        const { cleanText } = parseSmartQuotedText(document.getText(selection));
        const key = createKey(cleanText);
        edit.replace(document.uri, selection, `{t("${key}")}`);
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();

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
 * 2. اختصار الـ Props والخصائص الخام: Ctrl + Shift + S
 * يستبدل النص بـ "key" مباشرة بدون دالة وأقواس بعد ترجمته
 */
async function translateSelectionRawKey(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections.map(s => document.getText(s)).filter(t => t.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage("حدد كلمة أو جملة أولاً.");
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
        const { cleanText } = parseSmartQuotedText(originalText);
        const key = createKey(cleanText);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEntries.push({ originalText: cleanText, key });
        }
    }

    const existing = uniqueEntries.filter(
        e => Object.prototype.hasOwnProperty.call(englishData, e.key) || Object.prototype.hasOwnProperty.call(arabicData, e.key)
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

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Translation Helper: جاري الترجمة بالذكاء الاصطناعي...",
            cancellable: false
        },
        async () => {
            for (const entry of uniqueEntries) {
                if (!englishData[entry.key]) englishData[entry.key] = entry.originalText;
                if (!arabicData[entry.key]) {
                    arabicData[entry.key] = await translateToArabic(apiKey, entry.originalText);
                }
            }
        }
    );

    saveLocaleFiles(englishPath, englishData, arabicPath, arabicData);

    const edit = new vscode.WorkspaceEdit();
    for (const selection of selections) {
        if (selection.isEmpty) continue;
        const { cleanText } = parseSmartQuotedText(document.getText(selection));
        const key = createKey(cleanText);
        edit.replace(document.uri, selection, `"${key}"`);
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();

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
 * 3. اختصار التغليف السريع: Ctrl + Shift + A
 * يغلف المتغير المحدد بـ t() مباشرة دون ترجمة أو تعديل لملفات اللغات
 * مثال: {item.title} -> {t(item.title)} أو f -> t(f)
 */
async function wrapWithTranslationFunction() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const edit = new vscode.WorkspaceEdit();

    let count = 0;
    for (const selection of selections) {
        if (selection.isEmpty) continue;
        const text = document.getText(selection).trim();
        if (!text) continue;

        let replacement;
        // إذا كان التحديد محاطاً بأقواس معقوفة {item.title}
        if (text.startsWith("{") && text.endsWith("}")) {
            const inner = text.slice(1, -1).trim();
            replacement = `{t(${inner})}`;
        } else {
            replacement = `t(${text})`;
        }

        edit.replace(document.uri, selection, replacement);
        count++;
    }

    if (count > 0) {
        await vscode.workspace.applyEdit(edit);
    }
}

/**
 * 4. اختصار قوالب EJS المدمج: Ctrl + Shift + W
 * يترجم بالذكاء الاصطناعي ويستبدل بـ <%= __('key')%> مع احترام نوع علامات التنصيص
 */
async function translateEjsSmartWithAI(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections.map(s => document.getText(s)).filter(t => t.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage("حدد النص أولاً.");
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
    const entries = selectedTexts.map(text => parseSmartQuotedText(text));
    const uniqueEntries = [];
    const seenKeys = new Set();

    for (const entry of entries) {
        const key = createKey(entry.cleanText);
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
                if (!englishData[entry.key]) englishData[entry.key] = entry.cleanText;
                if (!arabicData[entry.key]) {
                    arabicData[entry.key] = await translateToArabic(apiKey, entry.cleanText);
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
        const key = createKey(entry.cleanText);
        edit.replace(document.uri, selection, `<%= __(${entry.quote}${key}${entry.quote})%>`);
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();
    vscode.window.showInformationMessage(`تمت ترجمة ${uniqueEntries.length} نصوص لـ EJS.`);
}

/**
 * 5. اختصار نصوص JS داخل EJS: Ctrl + Shift + Q
 */
async function translateEjsWithAI(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections.map(s => document.getText(s)).filter(t => t.length > 0);

    const entries = selectedTexts.map(text => parseSmartQuotedText(text));

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
        const key = createKey(entry.cleanText);
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
                if (!englishData[entry.key]) englishData[entry.key] = entry.cleanText;
                if (!arabicData[entry.key]) {
                    arabicData[entry.key] = await translateToArabic(apiKey, entry.cleanText);
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
        const key = createKey(entry.cleanText);
        edit.replace(document.uri, selection, `__(${entry.quote}${key}${entry.quote})`);
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();
    vscode.window.showInformationMessage(`تمت ترجمة ${uniqueEntries.length} نصوص لـ EJS.`);
}

/**
 * اختصار الشروط والـ Ternary: Ctrl + Shift + Z
 * - يترجم النص بالذكاء الاصطناعي ويضيفه إلى en.json و ar.json
 * - يستبدل النص المحدد بـ t('key') أو t("key") محتفظاً بنفس نوع التنصيص
 * - يفتح ar.json ويضع المؤشر على القيمة العربية للمراجعة
 */
async function translateTernaryWithT(context) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const document = editor.document;
    const selections = editor.selections;
    const selectedTexts = selections.map(s => document.getText(s)).filter(t => t.length > 0);

    if (selectedTexts.length === 0) {
        vscode.window.showWarningMessage("حدد النص أولاً.");
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
    const entries = selectedTexts.map(text => parseSmartQuotedText(text));
    const uniqueEntries = [];
    const seenKeys = new Set();

    for (const entry of entries) {
        const key = createKey(entry.cleanText);
        if (!seenKeys.has(key)) {
            seenKeys.add(key);
            uniqueEntries.push({ ...entry, key });
        }
    }

    // التحقق من تكرار المفتاح
    const existing = uniqueEntries.filter(
        e => Object.prototype.hasOwnProperty.call(englishData, e.key) || Object.prototype.hasOwnProperty.call(arabicData, e.key)
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
                if (!englishData[entry.key]) englishData[entry.key] = entry.cleanText;
                if (!arabicData[entry.key]) {
                    arabicData[entry.key] = await translateToArabic(apiKey, entry.cleanText);
                }
            }
        }
    );

    // حفظ ملفات الترجمة
    saveLocaleFiles(englishPath, englishData, arabicPath, arabicData);

    // استبدال النص بـ t('key') أو t("key") مع الحفاظ على التنصيص الأصلي
    const edit = new vscode.WorkspaceEdit();
    for (let i = 0; i < selections.length; i++) {
        const selection = selections[i];
        if (selection.isEmpty) continue;
        const entry = entries[i];
        const key = createKey(entry.cleanText);
        edit.replace(document.uri, selection, `t(${entry.quote}${key}${entry.quote})`);
    }

    await vscode.workspace.applyEdit(edit);
    await document.save();

    // فتح ar.json وتحديد موضع القيمة للمراجعة
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
        vscode.commands.registerCommand("translationHelper.translateSelectionRawKey", () => translateSelectionRawKey(context)),
        vscode.commands.registerCommand("translationHelper.wrapWithTranslationFunction", () => wrapWithTranslationFunction()),
        vscode.commands.registerCommand("translationHelper.translateEjsStringWithAI", () => translateEjsSmartWithAI(context)),
        vscode.commands.registerCommand("translationHelper.translateEjsWithAI", () => translateEjsWithAI(context)),
        vscode.commands.registerCommand("translationHelper.translateTernaryWithT", () => translateTernaryWithT(context)),
        vscode.commands.registerCommand("translationHelper.setApiKey", () => setOpenAIKey(context))
    );
}

function deactivate() { }

module.exports = {
    activate,
    deactivate
};